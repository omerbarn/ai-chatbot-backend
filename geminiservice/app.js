const express = require("express");
const app = express();

app.get("/ask", (req, res) => {
    const user = req.query.user;
    let answer1, answer2;

    answer1 = "what colour is a labrador";
    answer2 = "i love labradors";

    res.json({
        user_answer1: answer1,
	user_answer2: answer2,
        user: user
    });
});

const port = parseInt(process.env.PORT) || 8080;
app.listen(port, () => {
    console.log(`gemini service: listening on port ${port}`);
});

app.get("/", (req, res) => {
    res.send("welcome to hard-coded gemini!");
});
