import torch
print("CUDA available:", torch.cuda.is_available())
print("torch CUDA version:", torch.version.cuda)
print("cuDNN version:", torch.backends.cudnn.version())
print("cuDNN available:", torch.backends.cudnn.is_available())

print(torch.cuda.get_device_name(0))
