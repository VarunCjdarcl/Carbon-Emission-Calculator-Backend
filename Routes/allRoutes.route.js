const express = require("express");
const app = express();
const router = express.Router();

const {
  calculateTKM,
  calculateCarbonEmission,
  truckTypes,
  checkLimit
} = require("../Controllers/allControllers.controller.js");

router.route('/calculateTKM').post(calculateTKM);
router.route('/truckTypes').post(truckTypes);
router.route("/calculateCarbonEmission").post(calculateCarbonEmission);
router.route("/checkLimit").get(checkLimit);

module.exports = router;
