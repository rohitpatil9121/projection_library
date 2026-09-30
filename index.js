const express = require("express");
require("dotenv").config();
const app = express();


app.use(express.static("public"));



const port = process.env.PORT || 9600;
app.listen(port, () => {
    console.log(`listening on http://localhost:${port}/`);
});