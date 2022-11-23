const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
// const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const stripe = require("stripe")(
  "sk_test_51M6pynDoqXus93lmSCtHQmR7JIt71LFT43aufyCOEGOsJ714Cm8aBD473UAJVk2kDaMTcGwnyhxgk08CC95VcRs300KQPtK2Nt"
);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

require("dotenv").config();

//midleware
app.use(cors());
app.use(express.json());

/* 
auth info

"doctorsPortal"
"cIkloK1kq6AInKCs"
 */

//mongodb connection

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.jz1qjld.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send("unauthorised access");
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "forbiden access" });
    }
    req.decoded = decoded;
    next();
  });
};

async function run() {
  try {
    const doctorsAppointmentCollection = client
      .db("doctorsPortal")
      .collection("appointmentOption");
    const bookingCollection = client.db("doctorsPortal").collection("bookings");
    const usersCollection = client.db("doctorsPortal").collection("users");
    const doctorsCollection = client.db("doctorsPortal").collection("doctors");
    const paymentsCollection = client
      .db("doctorsPortal")
      .collection("payments");

    //midleware for verify admin to avoiding code repet

    // Note: make sure that you will run verifyAdmin function after verify JWT Function

    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "admin") {
        return res.status(403).send("forbidden Access");
      }
      next();
    };

    //Use aggrigate to query multiple collection and then merge data (it is not best practice we have to try advanced system later)
    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const query = {};
      const options = await doctorsAppointmentCollection.find(query).toArray();

      //get the booking of the porvided date
      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingCollection
        .find(bookingQuery)
        .toArray();

      //very important !!code carefully

      options.forEach((option) => {
        const optionBooked = alreadyBooked.filter(
          (book) => book.treatment === option.name
        );

        const bookedSlot = optionBooked.map((singleSlot) => singleSlot.slot);
        const remaining = option.slots.filter(
          (slot) => !bookedSlot.includes(slot)
        );
        option.slots = remaining;
      });

      res.send(options);
    }); //use this api or below v2 api. both are smae
    //get api for bookings for single person

    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        res.status(403).send({ message: "forbidden access" });
      }
      const query = {
        email: email,
      };

      const bookings = await bookingCollection.find(query).toArray();
      res.send(bookings);
    });

    //create api using version control

    app.get("/v2/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const options = await doctorsAppointmentCollection
        .aggregate([
          {
            $lookup: {
              from: "bookings",
              localField: "name",
              foreignField: "treatment",
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$appointmentDate", date],
                    },
                  },
                },
              ],
              as: "booked",
            },
          },
          {
            $project: {
              name: 1,
              slots: 1,
              price: 1,
              booked: {
                $map: {
                  input: "$booked",
                  as: "book",
                  in: "$$book.slot",
                },
              },
            },
          },
          {
            $project: {
              name: 1,
              price: 1,
              slots: {
                $setDifference: ["$slots", "$booked"],
              },
            },
          },
        ])
        .toArray();
      res.send(options);
    });

    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        appointmentDate: booking.appointmentDate,
        treatment: booking.treatment,
        email: booking.email,
      };
      const alreadyBooked = await bookingCollection.find(query).toArray();
      if (alreadyBooked.length) {
        const message = `already have a booking for you on${booking.appointmentDate}`;
        return res.send({ acknowledged: false, message });
      }
      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });

    //api for getting booking infor by id

    app.get("/booking/:id", async (req, res) => {
      const id = req.params.id;
      const booking = { _id: ObjectId(id) };
      const result = await bookingCollection.findOne(booking);
      res.send(result);
    });

    //get api for specific 1 or 2 field using .project method

    app.get("/appointmentSpeciality", async (req, res) => {
      const query = {};
      const result = await doctorsAppointmentCollection
        .find(query)
        .project({ name: 1 }) // here name in .project is used to filter out only the name field
        .toArray();
      res.send(result);
    });

    //get api for geting user info

    app.get("/users", async (req, res) => {
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    });

    //get api to check if the user is admin or not

    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === "admin" });
    });

    //api for admin role to update user info

    app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });

    //Temporaty price field update option in doctorsAppointmentCollection. Please don't use it in production level.

    /*  app.get("/updatePrice", async (req, res) => {
      const filter = {};
      const options = {
        upsert: true,
      };
      const updatedDoc = {
        $set: {
          price: 99,
        },
      };
      const result = await doctorsAppointmentCollection.updateMany(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    }); */

    //post api for collecting user info
    app.post("/users", async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    //post api for stripe payment getway system

    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    //post api for save payments info in db

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      const id = payment.bookingId;
      const filter = { _id: ObjectId(id) };
      updatedDoc = {
        $set: {
          paid: true,
          transectionId: payment.transectionId,
        },
      };
      const updateResult = await bookingCollection.updateOne(
        filter,
        updatedDoc
      );
      res.send(result);
      res.send(updateResult);
    });

    //get api for jsonwebtoken

    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
          expiresIn: "1h",
        });
        return res.send({ accessToken: token });
      }
      console.log(user);
      res.status(403).send({ accessToken: "unauthorised User" });
    });

    //get api for manage doctors collection

    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const result = await doctorsCollection.find(query).toArray();
      res.send(result);
    });

    app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    });

    //post api for doctors Collection

    app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result);
    });
  } finally {
  }
}
run().catch((error) => console.log(error));

//defaule get method
app.get("/", (req, res) => {
  res.send("Doctors protal server is running");
});

app.listen(port, () => {
  console.log(`Doctors portal server is running in port ${port}`);
});
