// Keep the shared app.json portable. Link only to an explicitly configured EAS project.
// Expo CLI loads local values from ignored .env files; cloud builds need EAS env values.
module.exports = ({ config }) => {
  const owner = process.env.ACTUM_EAS_OWNER?.trim();
  const projectId = process.env.ACTUM_EAS_PROJECT_ID?.trim();

  return {
    ...config,
    ...(owner ? { owner } : {}),
    ...(projectId
      ? {
          extra: {
            ...config.extra,
            eas: { ...config.extra?.eas, projectId },
          },
        }
      : {}),
  };
};
