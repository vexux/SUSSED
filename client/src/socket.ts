import { io } from "socket.io-client";
import { resolveSocketConfiguration, shouldConnectSocket } from "./socketConfig";
import {
  createSocketAuthPayloadProvider,
  getFirebaseSocketAuthPayload,
} from "./socketAuth";
import { authEnabled, firebaseClient, firebaseConfigurationError } from "./supabase";

const configuration = resolveSocketConfiguration(
  import.meta.env.VITE_SERVER_URL,
  import.meta.env.PROD,
);

function createSocket() {
  const serverUrl = configuration.serverUrl;
  if (!serverUrl || !shouldConnectSocket(serverUrl, authEnabled, firebaseConfigurationError)) {
    return io({ autoConnect: false });
  }
  if (!authEnabled) {
    return io(serverUrl);
  }
  return io(serverUrl, {
    auth: createSocketAuthPayloadProvider(() =>
      getFirebaseSocketAuthPayload(firebaseClient),
    ),
  });
}

export const socket = createSocket();

export const socketConfigurationError =
  (authEnabled ? firebaseConfigurationError : null) ?? configuration.errorMessage;

export const supabaseClient = firebaseClient;
export const supabaseConfigurationError = firebaseConfigurationError;
