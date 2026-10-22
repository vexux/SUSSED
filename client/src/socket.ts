import { io } from "socket.io-client";
import { resolveSocketConfiguration } from "./socketConfig";

const configuration = resolveSocketConfiguration(
  import.meta.env.VITE_SERVER_URL,
  import.meta.env.PROD,
);

export const socketConfigurationError = configuration.errorMessage;
export const socket = configuration.serverUrl
  ? io(configuration.serverUrl)
  : io({ autoConnect: false });
