import { io } from "socket.io-client";

const socket = io("http://localhost:3000");

socket.on("connect", () => {
    console.log("Connected to SUSSED! server");
    console.log("Socket ID:", socket.id);
});

socket.on("disconnect", () => {
    console.log("Disconnected from SUSSED! server");
});