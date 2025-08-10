const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const path = require('path');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: path.join(__dirname, 'src/media/spotify'), // Assumes 'src/media/icon.icns' exists

    // This is the ONLY configuration needed for the permission prompt text.
    // It is essential and must remain.
    extendInfo: {
      NSMicrophoneUsageDescription: 'This app needs access to your microphone to capture your speech for transcription and AI-powered interview coaching.'
    },

    // The osxSign block has been COMPLETELY REMOVED to prevent the
    // "Code Signature Invalid" crash on local development builds.
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};