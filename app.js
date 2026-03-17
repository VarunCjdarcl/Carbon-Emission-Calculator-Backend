const express = require('express');
const allRoutes = require('./Routes/allRoutes.route.js');

const app = express();
const router = express.Router();

const bodyParser = require('body-parser');
app.use(bodyParser.json());//for getting data from raw>body>json

//CORS HEADER MIDLEWARE
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
  });

app.use('/carbonEmission', allRoutes);

app.listen(8000, () => {
    console.log("Project is listening at 8000");
});
