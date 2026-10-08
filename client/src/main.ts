import "./style.css";
import { createInitialAppState } from "./appState";
import { socket } from "./socket";
import { renderApp } from "./views";

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
    throw new Error("The application root element was not found.");
}

const state = createInitialAppState();
renderApp(app, state);

socket.on("connect", () => {
    state.connectionStatus = "connected";
    console.log("Connected to SUSSED! server");
    console.log("Socket ID:", socket.id);
    renderApp(app, state);
});

socket.on("disconnect", () => {
    state.connectionStatus = "disconnected";
    console.log("Disconnected from SUSSED! server");
    renderApp(app, state);
});