const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const saltRounds = 10;
const uri = "mongodb+srv://sivarshree:jtq7iURcAmM9wngH@cluster0.b8ir8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// MongoDB client setup
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

app.use(express.json());

// JWT verification middleware (reads token from the request body)
function verifyToken(req, res, next) {
  const token = req.body.token; // Retrieve token from request body

  if (!token) return res.status(401).send("Access Denied");

  jwt.verify(token, "secretKey", (err, decoded) => {
    if (err) return res.status(403).send("Invalid Token");
    req.identify = decoded;
    next();
  });
}

// MongoDB connection
async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB!");
  } catch (err) {
    console.error(err);
  }
}
run().catch(console.dir);

//// DRIVER ENDPOINTS ////

// Driver Registration
app.post('/drivers/register', async (req, res) => {
  const { name, username, password, carModel, carColor, carPlate } = req.body;

  try {
    const existingDriver = await client.db("MyTaxiDB").collection("Drivers").findOne({ username });
    if (existingDriver) return res.status(400).send("Username already exists");

    const hashedPassword = bcrypt.hashSync(password, saltRounds);
    await client.db("MyTaxiDB").collection("Drivers").insertOne({
      name, username, password: hashedPassword, carModel, carColor, carPlate,
    });

    res.status(201).send("Driver registered successfully");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error registering driver");
  }
});

// Driver Login
app.post('/drivers/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const driver = await client.db("MyTaxiDB").collection("Drivers").findOne({ username });
    if (!driver) return res.status(404).send("Driver not found");

    const isPasswordValid = bcrypt.compareSync(password, driver.password);
    if (!isPasswordValid) return res.status(401).send("Invalid password");

    const token = jwt.sign({ userId: driver._id, role: 'driver' }, "secretKey", { expiresIn: '1h' });
    res.status(200).send({ token });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error logging in");
  }
});

// Driver View Rides
app.get('/drivers/view-rides', verifyToken, async (req, res) => {
  if (req.identify.role !== 'driver') return res.status(403).send("Access Denied");

  try {
    const rides = await client.db("MyTaxiDB").collection("Rides").find({ status: "pending" }).toArray();

    if (rides.length === 0) {
      console.log("There are no jobs available for drivers at the moment.");
      return res.status(200).send("There are no jobs available at the moment.");
    }

    res.status(200).send(rides);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving rides");
  }
});


// Driver Accept Ride
app.post('/drivers/accept-ride', verifyToken, async (req, res) => {
  if (req.identify.role !== 'driver') return res.status(403).send("Access Denied");

  const { rideId } = req.body;

  try {
    const ride = await client.db("MyTaxiDB").collection("Rides").findOne({ _id: new ObjectId(rideId) });
    if (!ride || ride.status !== "pending") return res.status(400).send("Ride not available");

    await client.db("MyTaxiDB").collection("Rides").updateOne({ _id: new ObjectId(rideId) }, {
      $set: { status: "accepted", driverId: req.identify.userId }
    });

    res.status(200).send("Ride accepted successfully");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error accepting ride");
  }
});

//// PASSENGER ENDPOINTS ////

// Passenger Registration
app.post('/passengers/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    const existingPassenger = await client.db("MyTaxiDB").collection("Passengers").findOne({ username });
    if (existingPassenger) return res.status(400).send("Username already exists");

    const hashedPassword = bcrypt.hashSync(password, saltRounds);
    await client.db("MyTaxiDB").collection("Passengers").insertOne({ username, password: hashedPassword });

    res.status(201).send("Passenger registered successfully");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error registering passenger");
  }
});

// Passenger Login
app.post('/passengers/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const passenger = await client.db("MyTaxiDB").collection("Passengers").findOne({ username });
    if (!passenger) return res.status(404).send("Passenger not found");

    const isPasswordValid = bcrypt.compareSync(password, passenger.password);
    if (!isPasswordValid) return res.status(401).send("Invalid password");

    const token = jwt.sign({ userId: passenger._id, role: 'passenger' }, "secretKey", { expiresIn: '1h' });
    res.status(200).send({ token });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error logging in");
  }
});

// Passenger Request Ride
app.post('/passengers/request-ride', verifyToken, async (req, res) => {
  if (req.identify.role !== 'passenger') return res.status(403).send("Access Denied");

  const { pickup, dropoff } = req.body;

  try {
    const activeRide = await client.db("MyTaxiDB").collection("Rides").findOne({
      passengerId: req.identify.userId,
      status: { $in: ['pending', 'accepted'] }
    });

    if (activeRide) return res.status(400).send("You already have an active ride");

    await client.db("MyTaxiDB").collection("Rides").insertOne({
      passengerId: req.identify.userId, pickup, dropoff, status: "pending", createdAt: new Date()
    });

    res.status(201).send("Ride requested successfully");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error requesting ride");
  }
});

// Passenger Cancel Ride
app.post('/passengers/cancel-ride', verifyToken, async (req, res) => {
  if (req.identify.role !== 'passenger') return res.status(403).send("Access Denied");

  try {
    const passengerId = req.identify.userId;

    // Find the active ride for the passenger
    const activeRide = await client.db("MyTaxiDB").collection("Rides").findOne({
      passengerId: passengerId,
      status: { $in: ["pending", "accepted"] }
    });

    if (!activeRide) return res.status(400).send("No active ride to cancel");

    // Update the ride status to "cancelled" and include cancellation details
    await client.db("MyTaxiDB").collection("Rides").updateOne(
      { _id: activeRide._id },
      { $set: { status: "cancelled", cancelledAt: new Date(), cancelledBy: "passenger" } }
    );

    res.status(200).send("Ride cancelled successfully");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error cancelling ride");
  }
});


//// ADMIN ENDPOINTS ////

// Admin View All Rides Without Token
app.post('/admin/view-rides', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Validate admin credentials
    const admin = await client.db("MyTaxiDB").collection("Admins").findOne({ username });
    if (!admin) return res.status(404).send("Admin not found");

    const isPasswordValid = bcrypt.compareSync(password, admin.password);
    if (!isPasswordValid) return res.status(401).send("Invalid password");

    // Fetch all rides
    const rides = await client.db("MyTaxiDB").collection("Rides").find().toArray();
    res.status(200).send(rides);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving rides");
  }
});

// Admin Get Driver Details with Authentication
app.post('/admin/driver-details', async (req, res) => {
  const { username, password, driverId } = req.body;

  try {
    // Validate admin credentials
    const admin = await client.db("MyTaxiDB").collection("Admins").findOne({ username });
    if (!admin) return res.status(404).send("Admin not found");

    const isPasswordValid = bcrypt.compareSync(password, admin.password);
    if (!isPasswordValid) return res.status(401).send("Invalid password");

    // Fetch driver details
    const driver = await client.db("MyTaxiDB").collection("Drivers").findOne({ _id: new ObjectId(driverId) });
    if (!driver) return res.status(404).send("Driver not found");

    res.status(200).send(driver);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving driver details");
  }
});

// Admin Get Passenger Details with Authentication
app.post('/admin/passenger-details', async (req, res) => {
  const { username, password, passengerId } = req.body;

  try {
    // Validate admin credentials
    const admin = await client.db("MyTaxiDB").collection("Admins").findOne({ username });
    if (!admin) return res.status(404).send("Admin not found");

    const isPasswordValid = bcrypt.compareSync(password, admin.password);
    if (!isPasswordValid) return res.status(401).send("Invalid password");

    // Fetch passenger details
    const passenger = await client.db("MyTaxiDB").collection("Passengers").findOne({ _id: new ObjectId(passengerId) });
    if (!passenger) return res.status(404).send("Passenger not found");

    res.status(200).send(passenger);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving passenger details");
  }
});

//// START SERVER ////
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
