const rp = require("request-promise");
let moment = require("moment");

const ulipCache = new Map();

// --------------------- IP RATE LIMITING ---------------------
const MAX_CALCULATIONS_PER_DAY = 10;
const ipCalculationTracker = new Map(); // IP -> { count, resetTime }

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.connection?.remoteAddress || req.ip;
}

function getIpLimitInfo(ip) {
  const now = Date.now();
  const record = ipCalculationTracker.get(ip);

  if (!record || now >= record.resetTime) {
    return { count: 0, remaining: MAX_CALCULATIONS_PER_DAY, limitReached: false };
  }

  const remaining = Math.max(0, MAX_CALCULATIONS_PER_DAY - record.count);
  return { count: record.count, remaining, limitReached: remaining <= 0 };
}

function incrementIpCount(ip) {
  const now = Date.now();
  const record = ipCalculationTracker.get(ip);

  if (!record || now >= record.resetTime) {
    // Set reset time to midnight of next day
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    ipCalculationTracker.set(ip, { count: 1, resetTime: tomorrow.getTime() });
  } else {
    record.count += 1;
    ipCalculationTracker.set(ip, record);
  }
}

async function checkLimit(req, res) {
  try {
    const ip = getClientIp(req);
    const info = getIpLimitInfo(ip);
    return res.send({
      status: 200,
      remaining: info.remaining,
      limitReached: info.limitReached,
      maxCalculations: MAX_CALCULATIONS_PER_DAY
    });
  } catch (error) {
    return res.send({ status: 400, message: "Error checking limit" });
  }
}
// --------------------- EMISSION FACTORS ---------------------
const emissionFactors = {
  RIGID: {
    "LDT (<3.5 t)": { WTT: 0.153, TTW: 0.756, WTW: 0.909 },
    "LDT 3.5-4.5 t GVW": { WTT: 0.10961, TTW: 0.36083, WTW: 0.47044 },
    "MDT 4.5-5.5 t GVW": { WTT: 0.09715, TTW: 0.31979, WTW: 0.41694 },
    "MDV 5.5-7.0 t GVW": { WTT: 0.09337, TTW: 0.30737, WTW: 0.40074 },
    "MDV 7.0-8.5 t GVW": { WTT: 0.07233, TTW: 0.23808, WTW: 0.31041 },
    "MDV 8.5-10.5 t GVW": { WTT: 0.06088, TTW: 0.20039, WTW: 0.26127 },
    "MDV 10.5-12.5 t GVW": { WTT: 0.05399, TTW: 0.17772, WTW: 0.23171 },
    "HDV 12.5-16.0 t GVW": { WTT: 0.04939, TTW: 0.16257, WTW: 0.21196 },
    "HDV 16.0-20.0 t GVW": { WTT: 0.02645, TTW: 0.0871, WTW: 0.11355 },
    "HDV 20.0-25.0 t GVW": { WTT: 0.02485, TTW: 0.08181, WTW: 0.10666 },
    "HDV 25.0-31.0 t GVW": { WTT: 0.02125, TTW: 0.06996, WTW: 0.09121 },
    "HDV >31.0 t GVW": { WTT: 0.02224, TTW: 0.0732, WTW: 0.09544 },

    // LNG
    "MDV 14-24 t GVW": { WTT: 0.05828, TTW: 0.13664, WTW: 0.19492 },
    "HDV 24-25 t GVW": { WTT: 0.02863, TTW: 0.06712, WTW: 0.09575 },
    "HDV 25-29 t GVW": { WTT: 0.02414, TTW: 0.05659, WTW: 0.08073 },
    "HDV 29-31 t GVW": { WTT: 0.02049, TTW: 0.04804, WTW: 0.06853 },
    "HDV 31-60 t GVW": { WTT: 0.01652, TTW: 0.03874, WTW: 0.05526 },

    //cng
    // "<3.5 t GVW": { WTT: 0.1615, TTW: 0.783, WTW: 0.9445 },
    // "3.5-7.5 t GVW": { WTT: 0.086, TTW: 0.231, WTW: 0.317 },
    // "7.5-12 t GVW": { WTT: 0.058, TTW: 0.154, WTW: 0.212 },
    // "12-17 t GVW": { WTT: 0.0237, TTW: 0.1151, WTW: 0.1389 },
    // "17-25 t GVW": { WTT: 0.0144, TTW: 0.0699, WTW: 0.0843 },
    // "25-32 t GVW": { WTT: 0.0098, TTW: 0.0477, WTW: 0.0576 },
    // ">32 t GVW": { WTT: 0.0069, TTW: 0.0334, WTW: 0.0403 },


    //cng
    "1.25-1.60 t GVW": { WTT: 0.0283, TTW: 0.1371, WTW: 0.1653 },
    "1.60-1.63 t GVW": { WTT: 0.0488, TTW: 0.2367, WTW: 0.2855},
    "1.63-2.00 t GVW": { WTT: 0.0530, TTW: 0.2570, WTW: 0.3100},
    "2.00-2.55 t GVW": { WTT: 0.0453, TTW: 0.2198, WTW: 0.2651 },
    "2.55-2.88 t GVW": { WTT: 0.0453, TTW: 0.1610, WTW:  0.1942},
    "2.88-3.00 t GVW": { WTT: 0.0390, TTW: 0.1890, WTW:  0.2280},
    "3.00-3.48 t GVW": { WTT: 0.0260, TTW: 0.1261, WTW:  0.1521},
    "3.48-7.49 t GVW": { WTT: 0.0350, TTW: 0.1697, WTW:  0.2047},
    "7.49-10.70 t GVW": { WTT: 0.0156, TTW: 0.0754, WTW: 0.0910 },
    "10.70-11.45 t GVW": { WTT: 0.0120, TTW: 0.0582, WTW:  0.0702},
    "11.45-14.25 t GVW": { WTT: 0.0131, TTW: 0.0634, WTW: 0.0765},
    "14.25-16.02 t GVW": { WTT: 0.0109, TTW: 0.0528, WTW: 0.0637 },
    "16.02-16.10 t GVW": { WTT: 0.0098, TTW: 0.0476, WTW: 0.0574 },
    "16.10-16.37 t GVW": { WTT: 0.0086, TTW: 0.0419, WTW:  0.0506},
    "16.37-17.75 t GVW": { WTT: 0.0092, TTW: 0.0445, WTW: 0.0537 },
    "17.75-18.50 t GVW": { WTT: 0.0086, TTW: 0.0418, WTW:  0.0504},
    "18.50-28.00 t GVW": { WTT: 0.0050, TTW: 0.0241, WTW:  0.0291},
    "28.00-42 t GVW": { WTT: 0.0068, TTW: 0.0328, WTW:  0.0396},
    ">=42 t GVW": { WTT: 0.0049, TTW: 0.0235, WTW:  0.0284},



    //electric
    "LDT up to 4.5t GVW": { WTT: 0.13544, TTW: 0.0, WTW: 0.13544 },
    "MDV up to 4.5-12t GVW": { WTT: 0.07487, TTW: 0.0, WTW: 0.07487 },
    "HDV above 12t GVW": { WTT: 0.14524, TTW: 0.0, WTW: 0.14524 },

    //hydrogen
    "HY-LDT up to 4.5t GVW": { WTT: 0.3281, TTW: 0.0, WTW: 0.3281 },
    "HY-MDV up to 4.5-12t GVW": { WTT: 0.1731, TTW: 0.0, WTW: 0.1731 },
    "HY-HDV above 12t GVW": { WTT: 0.19886, TTW: 0.0, WTW: 0.19886 },
  },

  ARTICULATED: {
    "HDV up to 18.0 t GVW": { WTT: 0.0367, TTW: 0.12081, WTW: 0.15751 },
    "HDV 18.0-27.0 t GVW": { WTT: 0.02499, TTW: 0.08226, WTW: 0.10725 },
    "HDV 27.0-35.0 t GVW": { WTT: 0.02254, TTW: 0.07421, WTW: 0.09675 },
    "HDV 35.0-40.0 t GVW": { WTT: 0.01884, TTW: 0.06202, WTW: 0.08086 },
    "HDV 40.0-43.0 t GVW": { WTT: 0.01822, TTW: 0.05966, WTW: 0.07788 },
    "HDV  43.0-46.0 t GVW": { WTT: 0.01749, TTW: 0.05757, WTW: 0.07506 },
    "HDV  46.0-49.0 t GVW": { WTT: 0.01734, TTW: 0.05709, WTW: 0.07443 },
    "HDV >49.0 t GVW": { WTT: 0.01722, TTW: 0.05667, WTW: 0.07389 },

    //LNG
    "14-24 t GVW": { WTT: 0.01495, TTW: 0.17572, WTW: 0.19067 },
    "24-25.1 t GVW": { WTT: 0.03584, TTW: 0.08402, WTW: 0.11986 },
    "25-29 t GVW": { WTT: 0.02984, TTW: 0.06995, WTW: 0.09979 },
    "HDV 29-31 t GVW": { WTT: 0.02466, TTW: 0.05783, WTW: 0.08249 },
    "HDV 31-60 t GVW": { WTT: 0.01987, TTW: 0.04658, WTW: 0.06645 },

    //cng
    "0-28 t GVW": { WTT: 0.0071, TTW: 0.0374, WTW: 0.0415 },
    "28-32 t GVW": { WTT: 0.0077, TTW: 0.0374, WTW: 0.0452 },
  },

  TANKER: {
    Tanker: { WTT: 0.012, TTW: 0.058, WTW: 0.07 },
  },

  DUMP: {

    // Diesel
    "LDT 3.5-4.5 t GVW": { WTT: 0.13016, TTW: 0.42846, WTW: 0.55862 },
    "MDT 4.5-5.5 t GVW": { WTT: 0.09673, TTW: 0.31843, WTW: 0.41516 },
    "MDV 5.5-7.0 t GVW": { WTT: 0.09162, TTW: 0.3016, WTW: 0.39322 },
    "MDV 7.0-8.5 t GVW": { WTT: 0.07107, TTW: 0.23396, WTW: 0.30503 },
    "MDV 8.5-10.5 t GVW": { WTT: 0.06112, TTW: 0.20119, WTW: 0.26231 },
    "MDV 10.5-12.5 t GVW": { WTT: 0.05239, TTW: 0.17248, WTW: 0.22487 },
    "MDV 12.5-16.0 t GVW": { WTT: 0.04804, TTW: 0.15814, WTW: 0.20618 },
    "HDV 16.0-20.0 t GVW": { WTT: 0.0356, TTW: 0.11721, WTW: 0.15281 },
    "HDV 20.0-25.0 t GVW": { WTT: 0.02328, TTW: 0.07663, WTW: 0.09991 },
    "HDV 25.0-31.0 t GVW": { WTT: 0.02147, TTW: 0.07006, WTW: 0.09153 },
    "HDV 31.0+ t GVW": { WTT: 0.01862, TTW: 0.0613, WTW: 0.07992 },


    // LNG
    "MDV 14-24 t GVW": { WTT: 0.05789, TTW: 0.13572, WTW: 0.19361 },
    "HDV 24-25 t GVW": { WTT: 0.02863, TTW: 0.06712, WTW: 0.09575 },
    "HDV 25-29 t GVW": { WTT: 0.02414, TTW: 0.05659, WTW: 0.08073 },
    "HDV 29-31 t GVW": { WTT: 0.02049, TTW: 0.04804, WTW: 0.06853 },
    "HDV 31-60 t GVW": { WTT: 0.01652, TTW: 0.03874, WTW: 0.05526 },
  }

};

// --------------------- HELPER FUNCTIONS ---------------------
function getValueByFieldKey(customFields, key) {
  // console.log(customFields);
  // console.log(key);

  const field = customFields.find((f) => f.fieldKey === key);
  console.log(field);

  return field ? field.value : null;
}

function mapVehicleCategory(vehicleTypeName) {
  if (!vehicleTypeName) return "RIGID";

  let type = vehicleTypeName.toUpperCase().trim();

  // ✅ Fix common spelling issues
  type = type.replace(/TRAILOR/g, "TRAILER").replace(/\s+/g, " ");

  const exactMap = {
    TRUCK: "RIGID",
    "CONTAINER TRUCK": "RIGID",
    "BODY TRAILER": "ARTICULATED",
    "CANOPY TRAILER": "ARTICULATED",
    "PLATFORM TRAILER": "ARTICULATED",
    "TANKER TRUCK": "TANKER",
    "TIPPER TRUCK": "RIGID",
    "PICK UP": "RIGID",
    LCV: "RIGID",
    "HYDRAULIC AXLE": "ARTICULATED",
    "TIPPER TRAILER": "ARTICULATED",
  };

  // ✅ First: Exact match
  if (exactMap[type]) {
    return exactMap[type];
  }

  // ✅ Fallback: partial match
  if (
    type.includes("TRAILER") ||
    type.includes("HYDRAULIC") ||
    type.includes("CONTAINER") ||
    type.includes("ARTICULATED")
  ) {
    return "ARTICULATED";
  }

  if (type.includes("TANKER")) {
    return "TANKER";
  }

  return "RIGID";
}

function getWeightCategory(category1, weight, fuelType) {
  let category = category1;
  console.log(
    `Determining weight category for Category: ${category}, Weight: ${weight}, Fuel: ${fuelType}`
  );

  // Since we don't have any data when category is ARTICULATED with CNG, so we change the category to RIGID
  // if (category === "ARTICULATED" && fuelType.toLowerCase() === "cng only") {
  //   category = "RIGID";
  // }

  // RIGID WITH DIESEL
  if (category === "RIGID" && fuelType.toLowerCase() === "diesel") {
    console.log(`🚚 Category: ${category}, Weight: ${weight}`);
    if (weight < 3.5) return "LDT (<3.5 t)";
    if (weight >= 3.5 && weight <= 4.5) return "LDT 1.5-4.5 t GVW";
    if (weight > 4.5 && weight <= 5.5) return "MDT 4.5-5.5 t GVW";
    if (weight > 5.5 && weight <= 7.0) return "MDV 5.5-7.0 t GVW";
    if (weight > 7.0 && weight <= 8.5) return "MDV 7.0-8.5 t GVW";
    if (weight > 8.5 && weight <= 10.5) return "MDV 8.5-10.5 t GVW";
    if (weight > 10.5 && weight <= 12.5) return "MDV 10.5-12.5 t GVW";
    if (weight > 12.5 && weight <= 16.0) return "HDV 12.5-16.0 t GVW";
    if (weight > 16.0 && weight <= 20.0) return "HDV 16.0-20.0 t GVW";
    if (weight > 20.0 && weight <= 25.0) return "HDV 20.0-25.0 t GVW";
    if (weight > 25.0 && weight <= 31.0) return "HDV 25.0-31.0 t GVW";
    if (weight > 31.0) return "HDV >31.0 t GVW";
  }

  if (category === "RIGID" && fuelType.toLowerCase() === "lng") {
    if (weight >= 14 && weight <= 24) return "MDV 14-24 t GVW";
    if (weight > 24 && weight <= 25) return "HDV 24-25 t GVW";
    if (weight > 25 && weight <= 29) return "HDV 25-29 t GVW";
    if (weight > 29 && weight <= 31) return "HDV 29-31 t GVW";
    if (weight > 31 && weight <= 60) return "HDV 31-60 t GVW";
  }

  if (category === "RIGID" && fuelType.toLowerCase() === "cng only") {
    console.log(`🚚 CNG Category: ${category}, Weight: ${weight}`);

    // if (weight < 3.5) return "<3.5 t GVW";
    // if (weight >= 3.5 && weight < 7.5) return "3.5-7.5 t GVW";
    // if (weight >= 7.5 && weight < 12) return "7.5-12 t GVW";
    // if (weight >= 12 && weight < 17) return "12-17 t GVW";
    // if (weight >= 17 && weight < 25) return "17-25 t GVW";
    // if (weight >= 25 && weight < 32) return "25-32 t GVW";
    // if (weight >= 32) return ">32 t GVW";
    if (weight >= 1.25 && weight < 1.6) return "1.25-1.60 t GVW";
    if (weight >= 1.6 && weight < 1.63) return "1.60-1.63 t GVW";
    if (weight >= 1.63 && weight < 2.0) return "1.63-2.00 t GVW";
    if (weight >= 2.0 && weight < 2.55) return "2.00-2.55 t GVW";
    if (weight >= 2.55 && weight < 2.88) return "2.55-2.88 t GVW";
    if (weight >= 2.88 && weight < 3.0) return "2.88-3.00 t GVW";
    if (weight >= 3.0 && weight < 3.48) return "3.00-3.48 t GVW";
    if (weight >= 3.48 && weight < 7.49) return "3.48-7.49 t GVW";
    if (weight >= 7.49 && weight < 10.7) return "7.49-10.70 t GVW";
    if (weight >= 10.7 && weight < 11.45) return "10.70-11.45 t GVW";
    if (weight >= 11.45 && weight < 14.25) return "11.45-14.25 t GVW";
    if (weight >= 14.25 && weight < 16.02) return "14.25-16.02 t GVW";
    if (weight >= 16.02 && weight < 16.1) return "16.02-16.10 t GVW";
    if (weight >= 16.1 && weight < 16.37) return "16.10-16.37 t GVW";
    if (weight >= 16.37 && weight < 17.75) return "16.37-17.75 t GVW";
    if (weight >= 17.75 && weight < 18.5) return "17.75-18.50 t GVW";
    if (weight >= 18.5 && weight < 28.0) return "18.50-28.00 t GVW";
    if (weight >= 28.0 && weight < 42) return "28.00-42 t GVW";
    if (weight >= 42) return ">=42 t GVW";
  }

  if (category === "RIGID" && fuelType.toLowerCase() === "electric") {
    if (weight < 4.5) return "LDT up to 4.5t GVW";
    if (weight >= 4.5 && weight <= 12) return "MDV up to 4.5-12t GVW";
    if (weight > 12) return "HDV above 12t GVW";
  }

  if (category === "RIGID" && fuelType.toLowerCase() === "hydrogen") {
    if (weight < 4.5) return "HY-LDT up to 4.5t GVW";
    if (weight >= 4.5 && weight <= 12) return "HY-MDV up to 4.5-12t GVW";
    if (weight > 12) return "HY-HDV above 12t GVW";
  }

  // ARTICULATED WITH DIESEL
  if (category === "ARTICULATED" && fuelType.toLowerCase() === "diesel") {
    if (weight <= 18.0) return "HDV up to 18.0 t GVW";
    if (weight > 18.0 && weight <= 27.0) return "HDV 18.0-27.0 t GVW";
    if (weight > 27.0 && weight <= 35.0) return "HDV 27.0-35.0 t GVW";
    if (weight > 35.0 && weight <= 40.0) return "HDV 35.0-40.0 t GVW";
    if (weight > 40.0 && weight <= 43.0) return "HDV 40.0-43.0 t GVW";
    if (weight > 43.0 && weight <= 46.0) return "HDV  43.0-46.0 t GVW";
    if (weight > 46.0 && weight <= 49.0) return "HDV  46.0-49.0 t GVW";
    if (weight > 49.0) return "HDV >49.0 t GVW";
  }

  if (category === "ARTICULATED" && fuelType.toLowerCase() === "lng") {
    if (weight <= 14.0 && weight <= 24.0) return "14-24 t GVW";
    if (weight > 24.0 && weight <= 25.1) return "24-25.1 t GVW";
    if (weight > 25.1 && weight <= 29.0) return "25-29 t GVW";
    if (weight > 29.0 && weight <= 31.0) return "HDV 29-31 t GVW";
    if (weight > 31.0 && weight <= 60.0) return "HDV 31-60 t GVW";
  }


  if (category === "ARTICULATED" && fuelType.toLowerCase() === "cng only") {
    if (weight > 0 && weight <= 28.0) return "0-28 t GVW";
    if (weight > 28.0 && weight <= 32.0) return "28-32 t GVW";
  }

  if (category === "TANKER") {
    return "Tanker";
  }

  if(category === "DUMP" && fuelType.toLowerCase() === "diesel") {
    if (weight >= 3.5 && weight <= 4.5) return "LDT 3.5-4.5 t GVW";
    if (weight > 4.5 && weight <= 5.5) return "LDT 4.5-5.5 t GVW";
    if (weight > 5.5 && weight <= 7.0) return "MDV 5.5-7.0 t GVW";
    if (weight > 7.0 && weight <= 8.5) return "MDV 7.0-8.5 t GVW";
    if (weight > 8.5 && weight <= 10.5) return "MDV 8.5-10.5 t GVW";
    if (weight > 10.5 && weight <= 12.5) return "MDV 10.5-12.5 t GVW";
    if (weight > 12.5 && weight <= 16.0) return "MDV 12.5-16.0 t GVW";
    if (weight > 16 && weight <= 20) return "HDV 16.0-20.0 t GVW";
    if (weight > 20 && weight <= 25) return "HD 20.0-25.0 t GVW";
    if (weight > 25 && weight <= 31) return "HDV 25.0-31.0 t GVW";
    if (weight > 31) return "HDV 31.0+ t GVW";
  }

  if(category === "DUMP" && fuelType.toLowerCase() === "lng") {
    if (weight >= 14 && weight <= 24) return "MDV 14-24 t GVW";
    if (weight > 24 && weight <= 25) return "HDV 24-25 t GVW";
    if (weight > 25 && weight <= 29) return "HDV 25-29 t GVW";
    if (weight > 29 && weight <= 31) return "HDV 29-31 t GVW";
    if (weight > 31 && weight <= 60) return "HDV 31-60 t GVW";
  }

  return null;
}

function getCfObj(fieldKey, value) {
    return {
      fieldKey: fieldKey,
      multiple: false,
      description: "",
      remark: "",
      required: false,
      accessType: null,
      input: "",
      unit: "",
      valueType: "string",
      options: [],
      fieldType: "string",
      value: value,
      isRemark: false,
    };
}

function formatVehicleNumber(vehicleNumber) {
  if (!vehicleNumber) return null;
  return vehicleNumber.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}



function computeAVersionWTW(category, weight, fuel, tkm) {
  const altWeightCat = getWeightCategory(category, weight, fuel);
  if (!altWeightCat) return null;

  const altFactor = emissionFactors[category]?.[altWeightCat];
  if (!altFactor) return null;

  return (altFactor.WTW * tkm).toFixed(3);
}

async function getUlipFallbackDetails(vehicleNumber) {
  const formattedNumber = formatVehicleNumber(vehicleNumber);
  if (!formattedNumber) return null;

  if (ulipCache.has(formattedNumber)) {
    return ulipCache.get(formattedNumber);
  }

  try {
    // Step 1: Login to ULIP and get token
    // const loginRes = await rp({
    //   method: "POST",
    //   url: "https://www.ulip.dpiit.gov.in/ulip/v1.0.0/user/login",
    //   headers: {
    //     "Content-Type": "application/json",
    //     Accept: "application/json",
    //   },
    //   body: JSON.stringify({
    //     username: "darcl_usr",
    //     password: "darcl@16122022",
    //   }),
    // });

    // const UlipToken = JSON.parse(loginRes)?.response?.id;
    // if (!UlipToken) throw new Error("ULIP Auth Failed");

    // // Step 2: Call VAHAN API
    // const vahanRes = await rp({
    //   method: "POST",
    //   url: "https://www.ulip.dpiit.gov.in/ulip/v1.0.0/VAHAN/01",
    //   headers: {
    //     Accept: "application/json",
    //     "Content-Type": "application/json",
    //     Authorization: `Bearer ${UlipToken}`,
    //   },
    //   body: JSON.stringify({ vehiclenumber: vehicleNumber }),
    // });
    // console.log(`ULIP Response for ${vehicleNumber}: ${vahanRes}`);

    const vahanRes = await rp({
      method: "GET",
      url: `https://tms-test.cjdarcl.com:8002/automate/autoapi/run/6c509e30-8323-4e4f-a823-aa160cfa3fed?vehicle=${formattedNumber}`,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    console.log(`ULIP Response for ${vehicleNumber}:`, vahanRes);

    const jsonData = JSON.parse(vahanRes);
    const xmlString = jsonData?.response?.[0]?.response;

    if (!xmlString) throw new Error("Invalid ULIP data format");

    // Step 3: Basic XML string parsing
    function extractTagValue(tag) {
      const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, "i");
      const match = xmlString.match(regex);
      return match ? match[1] : null;
    }

    const gvw = extractTagValue("rc_gvw");
    const bodyType = extractTagValue("rc_body_type_desc");
    const vchCatgDesc = extractTagValue("rc_vch_catg_desc");
    const fuelType = extractTagValue("rc_fuel_desc");

    console.log(gvw, bodyType, "djvbhsdl", vchCatgDesc, fuelType);

    const fallback = {
      weight: gvw ? parseFloat(gvw) / 1000 : null,
      vehicleType: bodyType || vchCatgDesc || null,
      fuelType: fuelType || null,
    };

    ulipCache.set(formattedNumber, fallback);
    return fallback;
  } catch (err) {
    console.error(`ULIP Fallback Error: ${err.message}`);
    return null;
  }
}

async function processShipmentDetails(shipmentDetails) {
  console.log("sdkvjb");

  // console.log(shipmentDetails.fleetInfo.vehicle.customFields);

  console.log(
    `Processing shipment: ${shipmentDetails.shipmentNumber} (${shipmentDetails.uuid})`
  );

  let customFields = shipmentDetails.customFields || [];
  let vehicleCustomFields =
    shipmentDetails.fleetInfo?.vehicle?.customFields || [];

  let distance = getValueByFieldKey(customFields, "TotalDistance");
  let ShipmentWt = getValueByFieldKey(customFields, "ShipmentWt");
  let vehicleType =
    shipmentDetails.fleetInfo?.vehicle?.vehicleLoadType?.vehicleCategory || "";
  let mode = shipmentDetails.transportationMode;
  let weight = null;
  let fuelType = null;

  console.log("dsvdmn ");
  console.log(typeof(distance));
  
  const distanceValue = parseFloat(distance);

if (distance == null || isNaN(distanceValue) || distanceValue === 0) {
      console.log("No distance found in custom fields, calculating fallback distance.");
    
    const shipmentStages = shipmentDetails.shipmentStages || [];
    console.log("shipmentStages[shipmentStages.length - 1].hub", shipmentStages[shipmentStages.length - 1].hub);
    const lastDest =
      shipmentStages[shipmentStages.length - 1].hub ??
      lastSh.shipmentStages[shipmentStages.length - 1].place.name;

    const currentOrigin = shipmentStages[0].hub ?? shipmentStages[0].place;

    const deptPoint = `${lastDest.centerCoordinates[1]},${lastDest.centerCoordinates[0]}`;
    const destPoint = `${currentOrigin.centerCoordinates[1]},${currentOrigin.centerCoordinates[0]}`;

    console.log("Dept:", deptPoint, "Dest:", destPoint);

    const fallbackDistance = await getTotalKM(deptPoint, destPoint);
    console.log("Distance:", fallbackDistance);


    if (fallbackDistance) {
      distance = fallbackDistance;
      console.log(
        `Fallback distance for shipment ${shipmentDetails.shipmentNumber}: ${distance}`
      );
    } else {
      console.warn(
        `No distance found for shipment ${shipmentDetails.shipmentNumber}`
      );
      return;
    }
  }

  if (mode === "ByTrain") {
    weight =
      getValueByFieldKey(customFields, "ShipmentWt") ||
      getValueByFieldKey(customFields, "GrossWeight");
    fuelType = "diesel";
    if (distance > 0 && distance < 10) {
      console.log(`Distance (${distance}) < 10, setting to 10 km`);
      distance = 10;
    }
    const finalTripNumberValue = getValueByFieldKey(
      customFields,
      "finalTripNumber"
    );

    // If finalTripNumber exists AND contains "EMPTY"
    if (finalTripNumberValue && finalTripNumberValue.includes("EMPTY")) {
      console.log("FinalTripNumber contains EMPTY → Setting weight to 4 tons");
      ShipmentWt = 4;
    }
  } else {
    let weightInKg = getValueByFieldKey(vehicleCustomFields, "GrossWeight");
    weight = weightInKg ? weightInKg / 1000 : null;
    fuelType = getValueByFieldKey(vehicleCustomFields, "FuelType");
  }

  console.log(
    `Processing shipment ${shipmentDetails.shipmentNumber} with mode: ${mode}, weight: ${weight}, type: ${vehicleType}, fuel: ${fuelType}, distance: ${distance}`
  );
  // If required fields are missing (except for byTrain), try fetching from ULIP
  if ((!vehicleType || !weight || !fuelType) && mode !== "ByTrain") {
    const vehicleNumber =
      shipmentDetails.fleetInfo?.vehicle?.vehicleRegistrationNumber;
    if (!vehicleNumber) {
      console.warn(
        `Skipping shipment ${shipmentDetails.uuid} due to missing vehicle number.`
      );
      return;
    }
    const fallback = await getUlipFallbackDetails(vehicleNumber);
    if (fallback) {
      weight = weight || fallback.weight;
      vehicleType = vehicleType || fallback.vehicleType;
      fuelType = fuelType || fallback.fuelType;
    }
  }

  // Skip shipment if any required parameter is still missing
  if (
    (mode === "ByRoad" &&
      (!weight || !vehicleType || !fuelType || !distance)) ||
    (mode === "byTrain" && (!weight || !fuelType || !distance))
  ) {
    console.warn(
      `Skipping shipment ${shipmentDetails.uuid} due to missing data. Mode: ${mode}, Weight: ${weight}, Type: ${vehicleType}, Fuel: ${fuelType}, Distance: ${distance}`
    );
    return;
  }

  const tkm = distance * ShipmentWt;
  console.log(tkm);

  if (mode !== "ByRoad") {

    let actualWTW = null;

    if (fuelType?.toLowerCase() === "electric") {
      actualWTW = ((tkm / 1000) * 4.50013).toFixed(3);
    } else if (fuelType?.toLowerCase() === "diesel") {
      actualWTW = ((tkm / 1000) * 4.975324).toFixed(3);
    } else {
      console.warn(
        `Skipping shipment ${shipmentDetails.uuid} due to unsupported fuel type: ${fuelType}`
      );
      return;
    }

    // Convert to number for formula
    const actual = Number(actualWTW);

    // -----------------------------
    // Rail A-Version formula:
    // AVersion = (Actual / 0.16) - Actual
    // -----------------------------
    const aVersion = ((actual / 0.16) - actual).toFixed(3);

    const payload = {
      shipmentId: shipmentDetails.uuid,
      updates: [
        {
          keyToUpdate: "customfields",
          updatedValue: [
            // 1️⃣ Actual emission
            getCfObj("carbonEmissionValue", actualWTW),

            // 2️⃣ A-Version emission
            getCfObj("aversionValue_rail", aVersion),

            getCfObj("isCarbonEmissionValue", "true"),
            getCfObj("totalEmissionUnit", "kgCO2e"),
          ],
        },
      ],
    };

    console.log(payload);
    await bulkSync(payload);
} else {
    const category = mapVehicleCategory(vehicleType);
    const weightCat = getWeightCategory(category, weight, fuelType);
    const factor = emissionFactors[category]?.[weightCat];

    if (!factor) {
      console.warn(
        `Skipping ${shipmentDetails.uuid} → No emission factor for ${category}, ${weightCat}`
      );
      return;
    }

    // -------- Actual emission ----------
    const WTT = (factor.WTT * tkm).toFixed(3);
    const TTW = (factor.TTW * tkm).toFixed(3);
    const WTW = (factor.WTW * tkm).toFixed(3);

    // --------- A-Version fuel comparison ---------
    const possibleFuels = ["diesel", "cng only", "lng", "electric", "hydrogen"];
    const actualFuel = fuelType.toLowerCase();

    const altCFValues = [];

    for (const f of possibleFuels) {
      if (f === actualFuel) continue;

      console.log(`Computing alternative fuel: ${f}`);
      

      const altWTW = computeAVersionWTW(category, weight, f, tkm);

      if (altWTW) {
        altCFValues.push(getCfObj(`aversionValue_${f}`, altWTW));
      }
    }

    // -------- Update CF ----------
    const payload = {
      shipmentId: shipmentDetails.uuid,
      updates: [
        {
          keyToUpdate: "customfields",
          updatedValue: [
            getCfObj("WTT", WTT),
            getCfObj("TTW", TTW),
            getCfObj("carbonEmissionValue", WTW),
            getCfObj("fuelUsed", actualFuel),
            ...altCFValues,
            getCfObj("isCarbonEmissionValue", "true"),
            getCfObj("totalEmissionUnit", "kgCO2e"),
          ],
        },
      ],
    };
   console.log(JSON.stringify(payload, null, 2));
   
    await bulkSync(payload);
  }
}

async function processShipmentDetailsNewDetails(
  allShipments
) {
  console.log("sdkvjb");

  const shipmentsWithoutEmissionFactorInRoad = [], shipmentsWithoutVehicleNumbr = [], shipmentsWithoutMissingParameters = [], shipmentsWithoutDistance = [], shipmentsWithUnsupportedFuelTypeInRail = [], shipmentsWithNoFuelTypeOrVehicleTypeInRoad = [];

  for (let shipmentDetails of allShipments) {
    // console.log(shipmentDetails.fleetInfo.vehicle.customFields);

    console.log(
      `Processing shipment: ${shipmentDetails.shipmentNumber} (${shipmentDetails.uuid})`
    );

    let customFields = shipmentDetails.customFields || [];
    let vehicleCustomFields =
      shipmentDetails.fleetInfo?.vehicle?.customFields || [];

    let distance = getValueByFieldKey(customFields, "TotalDistance");
    let ShipmentWt = getValueByFieldKey(customFields, "ShipmentWt");
    // let vehicleType =
    //   shipmentDetails.fleetInfo?.vehicle?.vehicleLoadType?.vehicleCategory ||
    //   "";
    let vehicleType = null;
    let mode = shipmentDetails.transportationMode;
    let weight = null;
    let fuelType = null;
    let vehicleNumber = shipmentDetails.fleetInfo?.vehicle?.vehicleRegistrationNumber || "";

    const fallback = await getUlipFallbackDetails(vehicleNumber);
    if(fallback && Object.keys(fallback).length > 0) {
      fuelType = fallback.fuelType;
      vehicleType = fallback.vehicleType;
    }

    console.log("dsvdmn ");
    console.log(typeof distance);

    const distanceValue = parseFloat(distance);

    if (distance == null || isNaN(distanceValue) || distanceValue === 0) {
      console.log(
        "No distance found in custom fields, calculating fallback distance."
      );

      const shipmentStages = shipmentDetails.shipmentStages || [];
      // const lastDest =
      //   shipmentStages[shipmentStages.length - 1].hub ??
      //   lastSh.shipmentStages[shipmentStages.length - 1].place.name;
      const lastDest =
        shipmentStages[shipmentStages.length - 1].hub ??
        shipmentStages[shipmentStages.length - 1].place;

      const currentOrigin = shipmentStages[0].hub ?? shipmentStages[0].place;

      const deptPoint = `${lastDest.centerCoordinates[1]},${lastDest.centerCoordinates[0]}`;
      const destPoint = `${currentOrigin.centerCoordinates[1]},${currentOrigin.centerCoordinates[0]}`;

      console.log("Dept:", deptPoint, "Dest:", destPoint);

      const fallbackDistance = await getTotalKM(deptPoint, destPoint);
      console.log("Distance:", fallbackDistance);

      if (fallbackDistance) {
        distance = fallbackDistance;
        console.log(
          `Fallback distance for shipment ${shipmentDetails.shipmentNumber}: ${distance}`
        );
      } else {
        if (mode !== "ByTrain") { // setting distance to 7 km for road shipments if distance = 0
          distance = 7;
        } else {
          shipmentsWithoutDistance.push({
          shipmentNumber: shipmentDetails?.shipmentNumber || "",
          uuid: shipmentDetails?.uuid || "",
          weight: weight || "",
          fuelType: fuelType || "",
          vehicleNumber: vehicleNumber || "",
          mode: mode || "",
          vehicleType: vehicleType || "",
          distance: distance || "",
          deptPoint: deptPoint || "",
          destPoint: destPoint || ""
        });
        continue;
        }
        console.warn(
          `No distance found for shipment ${shipmentDetails.shipmentNumber}`
        );
      }
    }

    if (mode !== "ByTrain" && distance == 1) {
      distance = 7; // setting distance to 7 km for road shipments if distance = 1
    }

    if (mode === "ByTrain") {
      weight =
        getValueByFieldKey(customFields, "ShipmentWt") ||
        getValueByFieldKey(customFields, "GrossWeight");
      fuelType = "diesel";
      if (distance > 0 && distance < 10) {
        console.log(`Distance (${distance}) < 10, setting to 10 km`);
        distance = 10;
      }
      const finalTripNumberValue = getValueByFieldKey(
        customFields,
        "finalTripNumber"
      );

      // If finalTripNumber exists AND contains "EMPTY"
      if (finalTripNumberValue && finalTripNumberValue.includes("EMPTY")) {
        console.log(
          "FinalTripNumber contains EMPTY → Setting weight to 4 tons"
        );
        ShipmentWt = 4;
      }
    } else {
      weight = getValueByFieldKey(customFields, "ShipmentWt") || null;
      if (weight) {
        const weightObj = await analyzeNumber(weight);
        if (
          weightObj &&
          Object.keys(weightObj).length &&
          weightObj?.integerDigitCount > 2
        ) {
          weight = weight / 1000;
        }
      }

      // if (!weight) {
      //   weight = getValueByFieldKey(customFields, "GrossWeight") || null;
      //   if(weight){
      //     let grossWeightType = getValueByFieldKey(customFields, "GrossWeightUom");
      //     if(grossWeightType == "Kilograms"){
      //       weight = weight / 1000;
      //     }
      //   }
      // }

      // let weightInKg = getValueByFieldKey(vehicleCustomFields, "GrossWeight");
      // weight = weightInKg ? weightInKg / 1000 : null;
      // fuelType = getValueByFieldKey(vehicleCustomFields, "FuelType");
    }

    console.log(
      `Processing shipment ${shipmentDetails.shipmentNumber} with mode: ${mode}, weight: ${weight}, type: ${vehicleType}, fuel: ${fuelType}, distance: ${distance}`
    );
    // If required fields are missing (except for byTrain), try fetching from ULIP
    if ((!vehicleType || !weight || !fuelType) && mode !== "ByTrain") {
      if (!vehicleNumber) {
        console.warn(
          `Skipping shipment ${shipmentDetails.uuid} due to missing vehicle number.`
        );
        shipmentsWithoutVehicleNumbr.push({
          shipmentNumber: shipmentDetails?.shipmentNumber || "",
          uuid: shipmentDetails?.uuid || "",
          weight: weight || "",
          fuelType: fuelType || "",
          vehicleNumber: shipmentDetails?.fleetInfo?.vehicle?.vehicleRegistrationNumber || "",
          mode: mode || "",
          vehicleType: vehicleType || "",
          distance: distance || ""
        });
        continue;
      }
      // const fallback = await getUlipFallbackDetails(vehicleNumber);
      // if (fallback) {
      //   weight = weight || fallback.weight;
      //   vehicleType = vehicleType || fallback.vehicleType;
      //   fuelType = fallback.fuelType || null;
      // }
      if (fallback) {
        weight = fallback.weight;
      }
    }

    if (mode === "ByRoad") {
      if (!fuelType && !vehicleType && !weight) {
        weight = 32; // setting weight to 32 tons if both fuel type and vehicle type are missing for road shipments
      }
      if (!fuelType) {
        fuelType = "diesel"; // setting fuel type to diesel if missing for road shipments
      }
      if (!vehicleType) {
        vehicleType = "Rigid"; // setting vehicle type to Rigid if missing for road shipments
      }
    }

    // Skip shipment if any required parameter is still missing
    if (
      (mode === "ByRoad" &&
        (!weight || !vehicleType || !fuelType || !distance)) ||
      (mode === "byTrain" && (!weight || !fuelType || !distance))
    ) {
      console.warn(
        `Skipping shipment ${shipmentDetails.uuid} due to missing data. Mode: ${mode}, Weight: ${weight}, Type: ${vehicleType}, Fuel: ${fuelType}, Distance: ${distance}`
      );
      shipmentsWithoutMissingParameters.push({
          shipmentNumber: shipmentDetails.shipmentNumber || "",
          uuid: shipmentDetails.uuid || "",
          weight: weight || "",
          fuelType: fuelType || "",
          vehicleNumber: shipmentDetails?.fleetInfo?.vehicle?.vehicleRegistrationNumber || "",
          mode: mode || "",
          vehicleType: vehicleType || "",
          distance: distance || ""
        });
      continue;
    }

    const tkm = distance * ShipmentWt;
    console.log(tkm);

    if (mode !== "ByRoad") {
      let actualWTW = null;

      // if (fuelType?.toLowerCase() === "electric") {
      //   actualWTW = ((tkm / 1000) * 4.50013).toFixed(3);
      // } else if (fuelType?.toLowerCase() === "diesel") {
      //   actualWTW = ((tkm / 1000) * 4.975324).toFixed(3);
      // }

      if(fuelType && ["electric", "diesel"].includes(fuelType.toLowerCase())){
        actualWTW = ((tkm) *  0.00912).toFixed(3);
      } 
      else {
        console.warn(
          `Skipping shipment ${shipmentDetails.uuid} due to unsupported fuel type: ${fuelType}`
        );
        shipmentsWithUnsupportedFuelTypeInRail.push({
          shipmentNumber: shipmentDetails.shipmentNumber || "",
          uuid: shipmentDetails.uuid || "",
          weight: weight || "",
          fuelType: fuelType || "",
          vehicleNumber: shipmentDetails?.fleetInfo?.vehicle?.vehicleRegistrationNumber || "",
          mode: mode || "",
          vehicleType: vehicleType || "",
          distance: distance || ""
        });
        continue;
      }

      // Convert to number for formula
      const actual = Number(actualWTW);

      // -----------------------------
      // Rail A-Version formula:
      // AVersion = (Actual / 0.16) - Actual
      // -----------------------------
      const aVersion = (actual / 0.16 - actual).toFixed(3);

      const payload = {
        shipmentId: shipmentDetails.uuid,
        updates: [
          {
            keyToUpdate: "customfields",
            updatedValue: [
              // 1️⃣ Actual emission
              getCfObj("carbonEmissionValue", actualWTW),

              // 2️⃣ A-Version emission
              getCfObj("aversionValue_rail", aVersion),

              getCfObj("isCarbonEmissionValue", "true"),
              getCfObj("totalEmissionUnit", "kgCO2e"),
            ],
          },
        ],
      };

      console.log(payload);
      await bulkSync(payload);
    } else {
      const category = mapVehicleCategory(vehicleType);
      if (
        category === "ARTICULATED" &&
        fuelType.toLowerCase() === "cng only" &&
        weight > 32
      ) {
        fuelType = "diesel";
      }
      let weightCat = getWeightCategory(category, weight, fuelType);
      const factor = emissionFactors[category]?.[weightCat];

      if ((factor && Object.keys(factor).length === 0) || !factor) {
        console.warn(
          `Skipping ${shipmentDetails.uuid} → No emission factor for ${category}, ${weightCat}`
        );
        shipmentsWithoutEmissionFactorInRoad.push({
          shipmentNumber: shipmentDetails.shipmentNumber || "",
          uuid: shipmentDetails.uuid || "",
          weight: weight || "",
          category: category || "",
          fuelType: fuelType || "",
          vehicleNumber: vehicleNumber || "",
          mode: mode || "",
          vehicleType: vehicleType || "",
          distance: distance || "",
          weightCat: weightCat || "",
          factor: factor || {}
        });

        const payload = {
          shipmentId: shipmentDetails.uuid,
          updates: [
            {
              keyToUpdate: "customfields",
              updatedValue: [
                getCfObj("isCarbonEmissionValue", "false")
              ],
            },
          ],
        };
        await bulkSync(payload);
        continue;
      }

      // -------- Actual emission ----------
      const WTT = (factor.WTT * tkm).toFixed(3);
      const TTW = (factor.TTW * tkm).toFixed(3);
      const WTW = (factor.WTW * tkm).toFixed(3);

      // --------- A-Version fuel comparison ---------
      const possibleFuels = [
        "diesel",
        "cng only",
        "lng",
        "electric",
        "hydrogen",
      ];
      const actualFuel = fuelType.toLowerCase();

      const altCFValues = [];

      for (const f of possibleFuels) {
        if (f === actualFuel) continue;

        console.log(`Computing alternative fuel: ${f}`);

        const altWTW = computeAVersionWTW(category, weight, f, tkm);

        if (altWTW) {
          altCFValues.push(getCfObj(`aversionValue_${f}`, altWTW));
        }
      }

      // -------- Update CF ----------
      const payload = {
        shipmentId: shipmentDetails.uuid,
        updates: [
          {
            keyToUpdate: "customfields",
            updatedValue: [
              getCfObj("WTT", WTT),
              getCfObj("TTW", TTW),
              getCfObj("carbonEmissionValue", WTW),
              getCfObj("fuelUsed", actualFuel),
              ...altCFValues,
              getCfObj("isCarbonEmissionValue", "true"),
              getCfObj("totalEmissionUnit", "kgCO2e"),
            ],
          },
        ],
      };
      console.log(JSON.stringify(payload, null, 2));

      await bulkSync(payload);
    }
  }

  return {
    shipmentsWithoutEmissionFactorInRoad: shipmentsWithoutEmissionFactorInRoad,
    shipmentsWithoutVehicleNumbr: shipmentsWithoutVehicleNumbr,
    shipmentsWithoutMissingParameters: shipmentsWithoutMissingParameters,
    shipmentsWithoutDistance: shipmentsWithoutDistance,
    shipmentsWithUnsupportedFuelTypeInRail:
      shipmentsWithUnsupportedFuelTypeInRail,
  };
}

async function analyzeNumber(num) {
  const numStr = num.toString();
  const isDecimal = numStr.includes('.');

  const parts = numStr.split('.');
  const integerPart = parts[0];

  const digitCount = integerPart.replace('-', '').length;

  return {
      original: num,
      type: isDecimal ? 'decimal' : 'whole number',
      integerDigitCount: digitCount
  };
}

async function calculateTKM(req, res) {
  try {
    const ip = getClientIp(req);
    const limitInfo = getIpLimitInfo(ip);

    if (limitInfo.limitReached) {
      return res.send({
        status: 429,
        message: "You have reached the maximum limit of 5 calculations for today. Please try again tomorrow.",
        remaining: 0,
        limitReached: true
      });
    }

    let { weight, distance, mode } = req?.body;
    if (!weight || !distance || !mode) {
      return res.send({
        status: 403,
        message: "Please provide Weight, Distance and Mode",
      });
    }

    const weightObj = await analyzeNumber(weight);
    if (
      weightObj &&
      Object.keys(weightObj).length &&
      weightObj?.integerDigitCount > 2
    ) {
      weight = weight / 1000;
    }

    const tkm = (distance * weight).toFixed(3);
    incrementIpCount(ip);
    const updatedLimit = getIpLimitInfo(ip);
    const shipmentDetails = {
      weight,
      distance,
      mode,
      tkm,
    };
    return res.send({ status: 200, shipmentDetails, remaining: updatedLimit.remaining, limitReached: updatedLimit.limitReached });
  } catch (error) {
    console.error(req, res);
    return res.send({
      status: 400,
      message: "Error occured while calculating t-Km",
    });
  }
}

async function calculateCarbonEmission(req, res) {
  try {

    const { tkm, mode, fuelType, vehicleType, weight, previousCarbonEmission = 0.000 } = req?.body;

    if(!tkm || !mode || !fuelType || !vehicleType || !weight){
      return res.send({status: 403, message: "Please provide all required fields"});
    }

    let responseData = {tkm, mode, fuelType, vehicleType, weight}, totalCarbonEmission;

    if (mode !== "ByRoad") {
      let actualWTW = null;

      if(fuelType && ["electric", "diesel"].includes(fuelType.toLowerCase())){
        actualWTW = ((tkm) *  0.00912).toFixed(3);
      } 
      else {
        return res.send({status: 403, message: `Unsupported fuel type: ${fuelType}`});
      }

      const actual = Number(actualWTW);
      const aVersion = (actual / 0.16 - actual).toFixed(3);
      if(previousCarbonEmission){
        totalCarbonEmission = (Number(previousCarbonEmission) + Number(actualWTW)).toFixed(3);
      }else {
        totalCarbonEmission = actualWTW;
      }
      Object.assign(responseData, {
        carbonEmissionValue: actualWTW,
        aversionValue: aVersion,
        totalCarbonEmission: totalCarbonEmission
      });

      return res.send({status: 200, responseData});
    } else {
      const category = mapVehicleCategory(vehicleType);
        let weightCat = getWeightCategory(category, weight, fuelType);
      const factor = emissionFactors[category]?.[weightCat];

      if ((factor && Object.keys(factor).length === 0) || !factor) {
        if (previousCarbonEmission) {
          totalCarbonEmission = (Number(previousCarbonEmission) + 0.00).toFixed(3);
        } else {
          totalCarbonEmission = 0.000;
        }
        Object.assign(responseData, {
        carbonEmissionValue: 0.000, WTT: 0.000, TTW: 0.000, WTW: 0.000, totalCarbonEmission
        });
        return res.send({status: 200, responseData});
      }

      // -------- Actual emission ----------
      const WTT = (factor.WTT * tkm).toFixed(3);
      const TTW = (factor.TTW * tkm).toFixed(3);
      const WTW = (factor.WTW * tkm).toFixed(3);

      // --------- A-Version fuel comparison ---------
      const possibleFuels = [
        "diesel",
        "cng only",
        "lng",
        "electric",
        "hydrogen",
      ];
      const actualFuel = fuelType.toLowerCase();

      const altCFValues = [];

      for (const f of possibleFuels) {
        if (f === actualFuel) continue;

        console.log(`Computing alternative fuel: ${f}`);

        const altWTW = computeAVersionWTW(category, weight, f, tkm);

        if (altWTW) {
          altCFValues.push(getCfObj(`aversionValue_${f}`, altWTW));
        }
      }


      if (previousCarbonEmission) {
        totalCarbonEmission = (Number(previousCarbonEmission) + Number(WTW)).toFixed(3);
      } else {
          totalCarbonEmission = WTW;
        }

      Object.assign(responseData, {
        carbonEmissionValue: WTW,
        WTT: WTT,
        TTW: TTW,
        WTW: WTW,
        totalCarbonEmission
      });
      return res.send({ status: 200, responseData });
    }

  } catch (error) {
    console.error(req, res);
    return res.send({
      status: 400,
      message: "Error occured while calculating Carbon Emission",
    });
  }
}

async function truckTypes(req, res) {
  try {
    // Road Truck Types
    const truckTypes = [
      { fullType: "Truck - Rigid (LDT (<3.5 t))", vehicleType: "Rigid", avgWeight: "1.75" },
      { fullType: "Truck - Rigid (LDT 3.5-4.5 t GVW)", vehicleType: "Rigid",  avgWeight: "4.0" },
      { fullType: "Truck - Rigid (MDT 4.5-5.5 t GVW)", vehicleType: "Rigid",  avgWeight: "5.0" },
      { fullType: "Truck - Rigid (MDV 5.5-7.0 t GVW)", vehicleType: "Rigid",  avgWeight: "6.25" },
      { fullType: "Truck - Rigid (MDV 7.0-8.5 t GVW)", vehicleType: "Rigid", avgWeight: "7.75" },
      { fullType: "Truck - Rigid (MDV 8.5-10.5 t GVW)", vehicleType: "Rigid",  avgWeight: "9.5" },
      { fullType: "Truck - Rigid (MDV 10.5-12.5 t GVW)", vehicleType: "Rigid",  avgWeight: "11.5" },
      { fullType: "Truck - Rigid (HDV 12.5-16.0 t GVW)", vehicleType: "Rigid",  avgWeight: "14.25" },
      { fullType: "Truck - Rigid (HDV 16.0-20.0 t GVW)", vehicleType: "Rigid",  avgWeight: "18.0" },
      { fullType: "Truck - Rigid (HDV 20.0-25.0 t GVW)", vehicleType: "Rigid",  avgWeight: "22.5" },
      { fullType: "Truck - Rigid (HDV 25.0-31.0 t GVW)", vehicleType: "Rigid", avgWeight: "28.0" },
      { fullType: "Truck - Rigid (HDV >31.0 t GVW)", vehicleType: "Rigid",  avgWeight: "32.0" },
      { fullType: "Truck - Articulated (HDV up to 18.0 t GVW)", vehicleType: "Articulated", avgWeight: "17.0" },
      { fullType: "Truck - Articulated (HDV 18.0-27.0 t GVW)", vehicleType: "Articulated", avgWeight: "22.5" },
      { fullType: "Truck - Articulated (HDV 27.0-35.0 t GVW)", vehicleType: "Articulated", avgWeight: "31.0" },
      { fullType: "Truck - Articulated (HDV 35.0-40.0 t GVW)", vehicleType: "Articulated", avgWeight: "37.5" },
      { fullType: "Truck - Articulated (HDV 40.0-43.0 t GVW)", vehicleType: "Articulated", avgWeight: "41.5" },
      { fullType: "Truck - Articulated (HDV 43.0-46.0 t GVW)", vehicleType: "Articulated", avgWeight: "44.5" },
      { fullType: "Truck - Articulated (HDV 46.0-49.0 t GVW)", vehicleType: "Articulated", avgWeight: "47.5" },
      { fullType: "Truck - Articulated (HDV >49.0 t GVW)", vehicleType: "Articulated", avgWeight: "50.0" },
      { fullType: "Truck - Dump (LDT 3.5-4.5 t GVW)", vehicleType: "Dump", avgWeight: "4.0" },
      { fullType: "Truck - Dump (MDT 4.5-5.5 t GVW)", vehicleType: "Dump", avgWeight: "5.0" },
      { fullType: "Truck - Dump (MDV 5.5-7.0 t GVW)", vehicleType: "Dump", avgWeight: "6.25" },
      { fullType: "Truck - Dump (MDV 7.0-8.5 t GVW)", vehicleType: "Dump", avgWeight: "7.75" },
      { fullType: "Truck - Dump (MDV 8.5-10.5 t GVW)", vehicleType: "Dump", avgWeight: "9.5" },
      { fullType: "Truck - Dump (MDV 10.5-12.5 t GVW)", vehicleType: "Dump", avgWeight: "11.5" },
      { fullType: "Truck - Dump (MDV 12.5-16.0 t GVW)", vehicleType: "Dump", avgWeight: "14.25" },
      { fullType: "Truck - Dump (HDV 16.0-20.0 t GVW)", vehicleType: "Dump", avgWeight: "18.0" },
      { fullType: "Truck - Dump (HDV 20.0-25.0 t GVW)", vehicleType: "Dump", avgWeight: "22.5" },
      { fullType: "Truck - Dump (HDV 25.0-31.0 t GVW)", vehicleType: "Dump", avgWeight: "28.0" },
      { fullType: "Truck - Dump (HDV 31.0+ t GVW)", vehicleType: "Dump", avgWeight: "32.0" },
      { fullType: "Truck - Articulated (14-24 t GVW)", vehicleType: "Articulated", avgWeight: "19.0" },
      { fullType: "Truck - Articulated (24-25 t GVW)", vehicleType: "Articulated", avgWeight: "24.5" },
      { fullType: "Truck - Articulated (25-29 t GVW)", vehicleType: "Articulated", avgWeight: "27.5" },
      { fullType: "Truck - Articulated (HDV 29-31 t GVW)", vehicleType: "Articulated", avgWeight: "30.5" },
      { fullType: "Truck - Articulated (HDV 31-60 t GVW)", vehicleType: "Articulated", avgWeight: "46.0" },

      { fullType: "Truck - Dump (MDV 14-24 t GVW)", vehicleType: "Dump", avgWeight: "19.0" },
      { fullType: "Truck - Dump (HDV 24-25 t GVW)", vehicleType: "Dump", avgWeight: "24.5" },
      { fullType: "Truck - Dump (HDV 25-29 t GVW)", vehicleType: "Dump", avgWeight: "27.5" },
      { fullType: "Truck - Dump (HDV 29-31 t GVW)", vehicleType: "Dump", avgWeight: "30.5" },

      { fullType: "Truck - Dump (HDV 31-60 t GVW)", vehicleType: "Dump", avgWeight: "46.0" },
      { fullType: "Truck - Rigid (MDV 14-24 t GVW)", vehicleType: "Rigid", avgWeight: "19.5" },
      { fullType: "Truck - Rigid (HDV 24-25 t GVW)", vehicleType: "Rigid",  avgWeight: "24.5" },
      { fullType: "Truck - Rigid (HDV 25-29 t GVW)", vehicleType: "Rigid",  avgWeight: "27.5" },
      { fullType: "Truck - Rigid (HDV 29-31 t GVW)", vehicleType: "Rigid",  avgWeight: "30.0" },
      { fullType: "Truck - Rigid (HDV 31-60 t GVW)", vehicleType: "Rigid",  avgWeight: "46.0" },

      { fullType: "Truck - Rigid (LDV up to 4.5 t GVW)", vehicleType: "Rigid", avgWeight: "3.0" },
      { fullType: "Truck - Rigid (MDV up to 4.5-12 t GVW)", vehicleType: "Rigid", avgWeight: "8.25" },
      { fullType: "Truck - Rigid (LDV above 12 t GVW)", vehicleType: "Rigid",  avgWeight: "24.5" },
      { fullType: "Truck - Rigid (Average < 3.5 t - 4.5 t)", vehicleType: "Rigid", avgWeight: "4.0" },

      { fullType: "Truck - Rigid (LDV up to 4.5 t GVW)", vehicleType: "Rigid", avgWeight: "2.25" },
      { fullType: "Truck - Rigid (MDV up to 4.5-12 t GVW)", vehicleType: "Rigid", avgWeight: "8.25" },
      { fullType: "Truck - Rigid (HDV above 12 t GVW)", vehicleType: "Rigid", avgWeight: "14" },
      { fullType: "Truck - Rigid (<3.5 t GVW)", vehicleType: "Rigid", avgWeight: "3.0" },
      { fullType: "Truck - Rigid (3.5-7.5 t GVW)", vehicleType: "Rigid", avgWeight: "5.5" },
      { fullType: "Truck - Rigid (7.5-12 t GVW)", vehicleType: "Rigid", avgWeight: "9.5" },
      { fullType: "Truck - Rigid (12-17 t GVW)", vehicleType: "Rigid", avgWeight: "14.5" },
      { fullType: "Truck - Rigid (17-25 t GVW)", vehicleType: "Rigid", avgWeight: "21.0" },
      { fullType: "Truck - Rigid (25-32 t GVW)", vehicleType: "Rigid", avgWeight: "28.5" },
      { fullType: "Truck - Rigid (>32 t GVW)", vehicleType: "Rigid", avgWeight: "33.0" },
      { fullType: "Truck - Articulated (25-32> t GVW)", vehicleType: "Articulated", avgWeight: "28.5" },
    ];
    return res.send({status: 200, truckTypes});
  } catch (error) {
    console.error(req, res);
    res.send({
      status: 400,
      message: "Error occured while getting Road Truck Types",
    });
  }
}


module.exports = {
  calculateTKM,
  calculateCarbonEmission,
  truckTypes,
  checkLimit
};