import { io } from "socket.io-client";
import { resolveSocketConfiguration, shouldConnectSocket } from "./socketConfig";
import {
  createSocketAuthPayloadProvider,
  getFirebaseSocketAuthPayload,
} from "./socketAuth";
import { authEnabled, firebaseClient, firebaseConfigurationError } from "./supabase";
import {
  attachRecoveryCredential,
  getBrowserSessionStorage,
  readRecoveryCredential,
  type RecoveryCredentialSource,
} from "./guestSession";

const configuration = resolveSocketConfiguration(
  import.meta.env.VITE_SERVER_URL,
  import.meta.env.PROD,
);
export const guestSessionStorage = getBrowserSessionStorage();
export let recoveryCredentialSource: RecoveryCredentialSource = null;
export let guestRecoveryStorageError = readRecoveryCredential(guestSessionStorage).error;
export const hasStoredGuestRecoveryCredential =
  readRecoveryCredential(guestSessionStorage).credential !== null;

function createSocket() {
  const serverUrl = configuration.serverUrl;
  if (
    !serverUrl ||
    !shouldConnectSocket(serverUrl, authEnabled, firebaseConfigurationError) ||
    !guestSessionStorage
  ) {
    return io({ autoConnect: false });
  }
  const authPayloadProvider = createSocketAuthPayloadProvider(() =>
    authEnabled ? getFirebaseSocketAuthPayload(firebaseClient) : Promise.resolve({}),
  );
  return io(serverUrl, {
    autoConnect: false,
    auth: (callback) => {
      authPayloadProvider((authPayload) => {
        const recovery = attachRecoveryCredential(authPayload, guestSessionStorage);
        guestRecoveryStorageError = recovery.error;
        recoveryCredentialSource = recovery.source;
        callback(recovery.authPayload);
      });
    },
  });
}

export const socket = createSocket();

export const socketConfigurationError =
  guestRecoveryStorageError ??
  (authEnabled ? firebaseConfigurationError : null) ??
  configuration.errorMessage;

export const supabaseClient = firebaseClient;
export const supabaseConfigurationError = firebaseConfigurationError;
