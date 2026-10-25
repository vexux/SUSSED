import { io } from "socket.io-client";
import { resolveSocketConfiguration } from "./socketConfig";
import {
  createSocketAuthPayloadProvider,
  getFirebaseSocketAuthPayload,
} from "./socketAuth";
import { firebaseClient, firebaseConfigurationError } from "./supabase";

const configuration = resolveSocketConfiguration(
  import.meta.env.VITE_SERVER_URL,
  import.meta.env.PROD,
);

export const socket =
  configuration.serverUrl && !firebaseConfigurationError
    ? io(configuration.serverUrl, {
        auth: createSocketAuthPayloadProvider(() =>
          getFirebaseSocketAuthPayload(firebaseClient),
        ),
      })
    : io({ autoConnect: false });

export const socketConfigurationError =
  firebaseConfigurationError ?? configuration.errorMessage;

export const supabaseClient = firebaseClient;
export const supabaseConfigurationError = firebaseConfigurationError;
