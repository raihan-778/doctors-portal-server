const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

require("dotenv").config();

//midleware
app.use(cors());
app.use(express.json());

/* 
auth info

"doctorsPortal"
"KsdFHtqDql5WHPKR"
 */

//mongodb connection

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.jz1qjld.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

async function run() {
  try {
    const doctorsAppointmentCollection = client
      .db("doctorsPortal")
      .collection("appointmentOption");
    const bookingCollection = client.db("doctorsPortal").collection("bookings");
    const usersCollection = client.db("doctorsPortal").collection("users");
    // const query = {};
    // const cursor = await doctorsAppointmentCollection.find(query).toArray();
    // console.log(cursor);

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

    app.get("/bookings", async (req, res) => {
      const email = req.query.email;
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
      console.log(booking);
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

    //post api for collecting user info
    app.post("/users", async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
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
