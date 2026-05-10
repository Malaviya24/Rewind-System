import * as FileSystem from "expo-file-system/legacy";
import { createUuid } from "@/utils/ids";

const deviceFile = `${FileSystem.documentDirectory}device-id.txt`;

export async function getDeviceId() {
  const info = await FileSystem.getInfoAsync(deviceFile);
  if (info.exists) {
    return FileSystem.readAsStringAsync(deviceFile);
  }
  const deviceId = `phone-${createUuid()}`;
  await FileSystem.writeAsStringAsync(deviceFile, deviceId);
  return deviceId;
}
