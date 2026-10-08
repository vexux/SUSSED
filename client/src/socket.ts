import { io } from "socket.io-client";

const serverUrl = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3000";

export const socket = io(serverUrl);
