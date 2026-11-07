function hasFirebaseCredentials(environment) {
  const serviceAccountJson = String(environment.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const individualCredentials = [
    environment.FIREBASE_PROJECT_ID,
    environment.FIREBASE_CLIENT_EMAIL,
    environment.FIREBASE_PRIVATE_KEY,
  ].some((value) => String(value || '').trim());
  return Boolean(serviceAccountJson || individualCredentials);
}

function useFirebasePersistence(environment = process.env) {
  const isRender = Boolean(environment.RENDER_SERVICE_ID);
  const configuredProvider = String(environment.PILAR_PERSISTENCE || '').trim().toLowerCase();
  const firebaseSelected = configuredProvider === 'firebase'
    || (!configuredProvider && isRender && hasFirebaseCredentials(environment));

  if (isRender && !firebaseSelected) {
    throw new Error('Render requiere PILAR_PERSISTENCE=firebase o credenciales de Firebase configuradas.');
  }
  return firebaseSelected;
}

module.exports = { useFirebasePersistence };
