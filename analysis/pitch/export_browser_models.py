from __future__ import annotations

import hashlib
import shutil
import tempfile
from pathlib import Path

import onnx
import swift_f0
import torch
import torchfcpe
from torchfcpe import spawn_bundled_infer_model


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_ROOT = ROOT / "public" / "models" / "vocal-pitch"
EXPECTED_FCPE_WEIGHT_SHA256 = "b9aeaeb673436eeda50ceafd632aa681aa63417e52eae4207503d180c9b10015"
EXPECTED_SWIFTF0_SHA256 = "fa91bb45512b90339cf4b00a599ba8fe3a253c46419fcfe6b46df77a8a8336a5"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class FcpeLatentFromAudio(torch.nn.Module):
    def __init__(self) -> None:
        super().__init__()
        infer = spawn_bundled_infer_model(device="cpu")
        mel = infer.wav2mel.mel_extractor
        self.register_buffer("mel_basis", mel.mel_basis)
        self.register_buffer("hann_window", torch.hann_window(1024))
        self.model = infer.model

    def forward(self, audio: torch.Tensor) -> torch.Tensor:
        samples = audio.squeeze(-1)
        samples = torch.nn.functional.pad(samples.unsqueeze(1), (432, 432), mode="reflect").squeeze(1)
        spectrum = torch.stft(
            samples,
            1024,
            hop_length=160,
            win_length=1024,
            window=self.hann_window,
            center=False,
            normalized=False,
            onesided=True,
            return_complex=True,
        )
        magnitude = torch.sqrt(spectrum.real.pow(2) + spectrum.imag.pow(2) + 1e-9)
        mel = torch.matmul(self.mel_basis, magnitude)
        mel = torch.log(torch.clamp(mel, min=1e-5)).transpose(-1, -2)
        mel = torch.cat((mel, mel[:, -1:, :]), dim=1)
        return self.model(mel)


def export_fcpe(output: Path) -> None:
    weight = Path(torchfcpe.__file__).parent / "assets" / "fcpe_c_v001.pt"
    if sha256(weight) != EXPECTED_FCPE_WEIGHT_SHA256:
        raise RuntimeError("torchfcpe bundled weight checksum changed")
    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary = Path(temporary_directory)
        external_model = temporary / "fcpe.onnx"
        torch.onnx.export(
            FcpeLatentFromAudio().eval(),
            (torch.zeros((1, 16000, 1), dtype=torch.float32),),
            external_model,
            input_names=["audio"],
            output_names=["latent"],
            dynamic_shapes={"audio": {1: torch.export.Dim("samples", min=1024)}},
            opset_version=20,
            dynamo=True,
        )
        model = onnx.load(external_model, load_external_data=True)
        onnx.save(model, output, save_as_external_data=False)


def copy_swiftf0(output: Path) -> None:
    source = Path(swift_f0.__file__).parent / "model.onnx"
    if sha256(source) != EXPECTED_SWIFTF0_SHA256:
        raise RuntimeError("SwiftF0 bundled model checksum changed")
    shutil.copyfile(source, output)


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    fcpe_output = OUTPUT_ROOT / "fcpe-v1.onnx"
    swift_output = OUTPUT_ROOT / "swift-f0-v1.onnx"
    export_fcpe(fcpe_output)
    copy_swiftf0(swift_output)
    print(f"{fcpe_output}: {fcpe_output.stat().st_size} bytes, sha256={sha256(fcpe_output)}")
    print(f"{swift_output}: {swift_output.stat().st_size} bytes, sha256={sha256(swift_output)}")
    print("Run the browser artifact tests and the fixed-corpus Python comparison before accepting new checksums.")


if __name__ == "__main__":
    main()
