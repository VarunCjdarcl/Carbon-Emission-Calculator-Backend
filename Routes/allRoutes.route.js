const express = require("express");
const app = express();
const router = express.Router();

const {
  calculateTKM,
  calculateCarbonEmission,
  truckTypes
} = require("../Controllers/allControllers.controller.js");

router.route('/calculateTKM').post(calculateTKM);
router.route('/truckTypes').post(truckTypes);
router.route("/calculateCarbonEmission").post(calculateCarbonEmission);

module.exports = router;
