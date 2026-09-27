import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // dev only: let phones on the local network (http://192.168.x.x:3001) load
  // the dev server's scripts, so the games can be tested on a real device
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
  // the dev badge sits in a corner, and every corner of a game screen is a
  // thumb control (it swallowed touches on the joystick); errors still show
  devIndicators: false,
};

export default nextConfig;
