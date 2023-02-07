const express = require('express');
const app = express();
const cors = require('cors');
const port = process.env.PORT || 5000;
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_KEY);
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.myfzpsp.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader)
    return res.status(401).send({ massage: 'Unauthorization access' });
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
    if (err) return res.status(403).send({ massage: 'forbidden access' });
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    const appoinmentCollection = client
      .db('doctorProtal')
      .collection('appointmentOption');
    const bookingsCollection = client.db('doctorProtal').collection('bookings');
    const userCollection = client.db('doctorProtal').collection('users');
    const doctorCollection = client.db('doctorProtal').collection('doctors');
    const paymentCollection = client.db('doctorProtal').collection('payment');

    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await userCollection.findOne(query);
      if (user.role !== `admin`) {
        return res.status(403).send({ massage: 'forbidden access' });
      }

      next();
    };

    // use aggegation to  query multiple collections in the marged data
    app.get('/appointmentOn', async (req, res) => {
      const date = req.query.date;
      const options = await appoinmentCollection.find({}).toArray();
      const bookingQuery = { appointmentDate: date };
      const alradyBooked = await bookingsCollection
        .find(bookingQuery)
        .toArray();
      options.forEach((option) => {
        const optionBooking = alradyBooked.filter(
          (booked) => booked.title === option.name
        );
        const bookedSorts = optionBooking.map((book) => book.slot);
        const reminingSolts = option.slots.filter(
          (slot) => !bookedSorts.includes(slot)
        );
        option.slots = reminingSolts;
      });
      res.send(options);
    });

    // alradyBooked.forEach((booked) =>   booked.title === option.);

    app.post('/bookings', async (req, res) => {
      const booking = req.body;

      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        title: booking.title,
      };
      const alradyBooked = await bookingsCollection.find(query).toArray();
      if (alradyBooked.length) {
        const bookedSlot = alradyBooked.find(
          (book) => book.title === booking.title
        );

        const massage = ` ${booking.title} already booked on ${booking.appoinemntDate} at ${bookedSlot.slot} `;
        return res.send({ acknowledged: false, massage });
      }
      const service = await bookingsCollection.insertOne(booking);
      res.send(service);
    });

    // get all bookings in users dashboard
    app.get('/bookings', verifyToken, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      const query = { email: email };
      const service = await bookingsCollection.find(query).toArray();
      res.send({ status: 'pandding', data: service });
    });

    app.get('/booking/admin', verifyToken, async (req, res) => {
      const result = await bookingsCollection.find({}).toArray();
      res.send(result);
    });
    app.get('/bookings/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await bookingsCollection.findOne(query);
      res.send(result);
    });

    // get all usees data in admin dashboard
    app.get('/users', async (req, res) => {
      const result = await userCollection.find({}).toArray();
      res.send(result);
    });

    // jwt token
    app.get('/jwt', async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
          expiresIn: '1h',
        });
        return res.send({ accessToken: token });
      }
      res.status(401).send({ accessToken: 'forbidden accesss' });
    });
    // get admin data
    app.get(
      '/users/admin/:email',
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const query = { email: email };
        const user = await userCollection.findOne(query);
        res.send({ isAdmin: user?.role === 'admin' });
      }
    );
    // saves users data
    app.post('/users', async (req, res) => {
      const email = req.body.email;
      const query = { email: email };

      const alreadyUser = await userCollection.findOne(query);
      if (alreadyUser) {
        return res.status(401).send({ massage: 'user already exist' });
      }
      const user = req.body;
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // admin as make admin
    app.put('/users/admin/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const option = { upsert: true };
      const updateDoc = { $set: { role: 'admin' } };
      const result = await userCollection.updateOne(filter, updateDoc, option);
      res.send(result);
    });
    app.put('/admin/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const option = { upsert: true };
      const updateDoc = { $unset: { role: 'admin' } };
      const result = await userCollection.updateOne(filter, updateDoc, option);
      res.send(result);
    });

    app.post('/doctors', verifyToken, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    });

    app.get('/doctors', verifyToken, verifyAdmin, async (req, res) => {
      const result = await doctorCollection.find({}).toArray();
      res.send(result);
    });

    app.delete('/doctors/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const result = await doctorCollection.deleteOne(filter);
      res.send(result);
    });
    // creact payment mahod in intend

    app.post('/create-payment-intent', async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: 'usd',
        payment_method_types: ['card'],
      });

      res.send({ clientSecret: paymentIntent.client_secret });
    });

    app.post('/payment', async (req, res) => {
      const payment = req.body;
      const result = await paymentCollection.insertOne(payment);
      const id = payment.bookingId;

      const filter = { _id: ObjectId(id) };
      const updateDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const updateResult = await bookingsCollection.updateOne(
        filter,
        updateDoc
      );
      res.send(result);
    });

    app.get('/payment', verifyToken, verifyAdmin, async (req, res) => {
      const result = await bookingsCollection.find({ paid: true }).toArray();
      res.send(result);
    });
  } finally {
  }
}

run().catch((err) => {
  console.log(err);
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
