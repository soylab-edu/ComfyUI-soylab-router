"""Comfy image, video and audio conversion helpers.

Torch/Pillow imports stay inside functions so catalog tests can run without
starting ComfyUI's Python environment.
"""

import base64
import io
import wave


def image_png_bytes(image) -> bytes:
    import numpy as np
    from PIL import Image

    if image is None:
        raise ValueError("이미지 입력이 비어 있습니다.")
    if len(image.shape) == 4:
        if image.shape[0] != 1:
            raise ValueError("한 슬롯에는 이미지 한 장만 연결하세요. 여러 장은 참조 슬롯을 늘려 연결하세요.")
        image = image[0]
    pixels = (image.detach().cpu().clamp(0, 1).numpy() * 255).astype(np.uint8)
    output = io.BytesIO()
    Image.fromarray(pixels).save(output, format="PNG")
    return output.getvalue()


def image_data_uri(image) -> str:
    return "data:image/png;base64," + base64.b64encode(image_png_bytes(image)).decode("ascii")


def audio_wav_bytes(audio) -> bytes:
    import numpy as np

    waveform = audio["waveform"].detach().cpu()
    if waveform.ndim == 3:
        if waveform.shape[0] != 1:
            raise ValueError("한 슬롯에는 오디오 한 개만 연결하세요.")
        waveform = waveform[0]
    if waveform.ndim == 1:
        waveform = waveform.unsqueeze(0)
    samples = (waveform.clamp(-1, 1).numpy().T * 32767).astype(np.int16)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(samples.shape[1])
        wav.setsampwidth(2)
        wav.setframerate(int(audio["sample_rate"]))
        wav.writeframes(samples.tobytes())
    return output.getvalue()


def audio_from_bytes(data: bytes):
    import numpy as np
    import torch

    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            if wav.getcomptype() != "NONE":
                raise ValueError("압축 WAV는 지원하지 않습니다.")
            channels, width, rate = wav.getnchannels(), wav.getsampwidth(), wav.getframerate()
            raw = wav.readframes(wav.getnframes())
        if width == 2:
            samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        elif width == 1:
            samples = (np.frombuffer(raw, dtype="u1").astype(np.float32) - 128.0) / 128.0
        else:
            raise ValueError("16비트 또는 8비트 PCM WAV만 지원합니다.")
        waveform = torch.from_numpy(samples.reshape(-1, channels).T.copy()).unsqueeze(0)
        return {"waveform": waveform, "sample_rate": rate}
    except wave.Error as exc:
        raise ValueError("오디오 결과를 WAV로 해석하지 못했습니다.") from exc


def image_from_bytes(data: bytes):
    import numpy as np
    import torch
    from PIL import Image

    with Image.open(io.BytesIO(data)) as image:
        pixels = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(pixels).unsqueeze(0)


def video_bytes(video) -> bytes:
    from comfy_api.latest import Types

    output = io.BytesIO()
    video.save_to(output, format=Types.VideoContainer.MP4, codec=Types.VideoCodec.H264)
    return output.getvalue()


def video_from_bytes(data: bytes):
    from comfy_api.latest._input_impl.video_types import VideoFromFile

    return VideoFromFile(io.BytesIO(data))
