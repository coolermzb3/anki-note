export interface MicrophoneChoice {
  deviceId: string;
  label: string;
}

export async function listMicrophoneChoices(): Promise<MicrophoneChoice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `麦克风 ${index + 1}` }));
}
