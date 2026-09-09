import os
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
from diffusers import ModularPipeline
pipe = ModularPipeline.from_pretrained('D:/Projects/MinimaxH3/vendor/MiniMax-H3', workflow='t2va', local_files_only=True)
print('BLOCKS', list(pipe.blocks.sub_blocks), flush=True)
print('COMPONENTS', list(pipe.components), flush=True)
print('INPUTS', [x.name for x in pipe.blocks.inputs], flush=True)
print('DENoise BLOCKS', list(pipe.blocks.sub_blocks['denoise'].sub_blocks), flush=True)
