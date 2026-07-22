/**
 * Location of the development toolchain fixture.
 *
 * This is scaffolding with a deliberately short life. 13h.dev does not ship a
 * compiler: users supply their own Turbo C++ install disks, which get unpacked
 * client-side and cached (step 3). Until that exists, `npm run toolchain:fixture`
 * produces this zip from a local copy of the disks so the compile and run
 * pipeline can be built and tested first.
 *
 * The zip is a plain (deflate) archive laid out as TC/BIN, TC/INCLUDE, TC/LIB,
 * TC/BGI -- mount its root as C: and you get the conventional C:\TC install.
 */
export const DEV_TOOLCHAIN_URL = "/dev-toolchain/tc101.zip";
