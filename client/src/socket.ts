import { io } from "socket.io-client";
import { resolveSocketConfiguration } from "./socketConfig";
import { createSocketAuthPayloadProvider } from "./socketAuth";
import { supabaseClient, supabaseConfigurationError } from "./supabase";

const configuration = resolveSocketConfiguration(
  import.meta.env.VITE_SERVER_URL,
  import.meta.env.PROD,
);

export const socket =
  configuration.serverUrl && !supabaseConfigurationError
    ? io(configuration.serverUrl, {
        auth: createSocketAuthPayloadProvider(
          () => supabaseClient
            ? supabaseClient.auth.getSession()
            : Promise.resolve({ data: { session: null }, error: null }),
        ),
      })
    : io({ autoConnect: false });

export const socketConfigurationError =
  supabaseConfigurationError ?? configuration.errorMessage;
