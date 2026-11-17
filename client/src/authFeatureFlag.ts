export interface AuthFeatureFlag {
  enabled: boolean;
  error: string | null;
}

export function resolveAuthFeatureFlag(value: string | undefined): AuthFeatureFlag {
  if (value === undefined) {
    return { enabled: false, error: null };
  }

  const setting = value.trim().toLowerCase();
  if (setting === "true") {
    return { enabled: true, error: null };
  }
  if (setting === "false") {
    return { enabled: false, error: null };
  }
  return {
    enabled: false,
    error: "VITE_AUTH_ENABLED must be set to true or false.",
  };
}
