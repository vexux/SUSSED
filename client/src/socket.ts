import { io } from "socket.io-client";
import { resolveSocketConfiguration } from "./socketConfig";
import { createSocketAuthPayloadProvider } from "./socketAuth";
import { firebaseClient, firebaseConfigurationError } from "./supabase";

const configuration = resolveSocketConfiguration(
  import.meta.env.VITE_SERVER_URL,
  import.meta.env.PROD,
);

export const socket =
  configuration.serverUrl && !firebaseConfigurationError
    ? io(configuration.serverUrl, {
        auth: createSocketAuthPayloadProvider(async () => {
          if (!firebaseClient) {
            return { data: { session: null }, error: null };
          }
          const user = firebaseClient.currentUser;
          if (!user) {
            return { data: { session: null }, error: null };
          }
          const accessToken = await user.getIdToken().catch(() => null);
          return accessToken ? { accessToken } : { data: { session: null }, error: null };
        }),
      })
    : io({ autoConnect: false });

export const socketConfigurationError =
  firebaseConfigurationError ?? configuration.errorMessage;

export const supabaseClient = firebaseClient;
export const supabaseConfigurationError = firebaseConfigurationError;
