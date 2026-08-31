// Auth providers for SIGESGD Capivari.
// This file configures authentication providers for the application.
// Existing: email OTP (for recovery/fallback), Anonymous (guest).
// Added: credentials (email + password) for primary authentication.

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { emailOtp } from "./auth/emailOtp";
import { credentials } from "./auth/credentials";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [credentials, emailOtp, Anonymous],
});
