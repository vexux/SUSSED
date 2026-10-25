import { io } from "socket.io-client";
import { resolveSocketConfiguration } from "./socketConfig";
import { supabaseClient, supabaseConfigurationError } from "./supabase";

const configuration = resolveSocketConfiguration(
  import.meta.env.VITE_SERVER_URL,
  import.meta.env.PROD,
);

export const socket =
  configuration.serverUrl && !supabaseConfigurationError
    ? io(configuration.serverUrl, {
        auth: (callback) => {
          if (!supabaseClient) {
            callback({});
            return;
          }

          void supabaseClient.auth.getSession().then(({ data, error }) => {
            if (error) {
              console.error(
                "Unable to load Supabase session for Socket.IO authentication.",
                error,
              );
              callback({ accessToken: null });
              return;
            }
            callback(data.session ? { accessToken: data.session.access_token } : {});
          }).catch((error: unknown) => {
            console.error(
              "Unable to load Supabase session for Socket.IO authentication.",
              error,
            );
            callback({ accessToken: null });
          });
        },
      })
    : io({ autoConnect: false });

export const socketConfigurationError =
  supabaseConfigurationError ?? configuration.errorMessage;
