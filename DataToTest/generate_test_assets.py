"""
generate_test_assets.py
=======================
Generates synthetic game asset files that cover every compression class
needed to fix the ML model's class imbalance.

Expected winner per category:
  lz4   → random_binary, already_compressed_blob, noise_texture
  gzip  → tiny_config, tiny_ini, tiny_lua
  zstd  → medium_json, shader_glsl, structured_xml, mixed_save
  bzip2 → repeated_pattern, large_source_code
  xz    → small_source_code (already covered — kept for balance)

Run from the CompressionPractice root:
    python DataToTest/generate_test_assets.py

Outputs go to DataToTest/synthetic/
"""

import os
import json
import random
import struct
import math
import string

random.seed(42)

OUT_DIR = os.path.join(os.path.dirname(__file__), "synthetic")
os.makedirs(OUT_DIR, exist_ok=True)


def write(filename, data):
    path = os.path.join(OUT_DIR, filename)
    if isinstance(data, str):
        data = data.encode("utf-8")
    with open(path, "wb") as f:
        f.write(data)
    size_kb = len(data) / 1024
    print(f"  {filename:<45} {size_kb:>8.1f} KB")
    return path


# ─────────────────────────────────────────────────────────────────────────────
# LZ4 targets — high entropy (entropy > 7.5), near-incompressible
# lz4 wins because its speed advantage beats the tiny ratio gain
# ─────────────────────────────────────────────────────────────────────────────

def gen_random_binary():
    """Pure random bytes — maximum entropy 8.0 bits/byte.
    Simulates a pre-compressed asset or encrypted save file."""
    data = bytes([random.randint(0, 255) for _ in range(512 * 1024)])  # 512 KB
    write("random_binary_512kb.bin", data)

def gen_noise_texture_rgba():
    """Random RGBA pixel data — simulates an uncompressed texture buffer
    before GPU encoding. Each pixel is 4 random bytes (R,G,B,A).
    No spatial coherence → entropy near 8.0."""
    # 256x256 RGBA = 256KB
    data = bytes([random.randint(0, 255) for _ in range(256 * 256 * 4)])
    write("noise_texture_256x256_rgba.raw", data)

def gen_already_compressed_blob():
    """Simulates a file that was already compressed (e.g. a .png re-saved as .bin,
    or a packed asset bundle). Uses repeated zlib-like high-entropy patterns."""
    # ZSTD magic header + random payload — looks like a compressed blob
    header = bytes([0x28, 0xB5, 0x2F, 0xFD])  # real zstd magic
    payload = bytes([random.randint(0, 255) for _ in range(200 * 1024)])
    write("precompressed_asset.bin", header + payload)

def gen_audio_pcm():
    """Raw PCM audio samples — high entropy in frequency domain.
    Simulates a WAV data chunk without header (32-bit float samples)."""
    import struct as s
    # 1 second mono 44100Hz = 44100 float32 samples ≈ 172KB
    samples = [random.gauss(0, 0.3) for _ in range(44100)]
    data = s.pack(f"{len(samples)}f", *samples)
    write("audio_pcm_44100hz_1sec.raw", data)


# ─────────────────────────────────────────────────────────────────────────────
# GZIP targets — tiny text files (< 8 KB), simple repetitive text
# gzip wins on tiny files because its lower overhead beats zstd's startup cost
# ─────────────────────────────────────────────────────────────────────────────

def gen_tiny_json_config():
    """Small game config JSON — 1-3 KB, high symbol redundancy."""
    cfg = {
        "version": "1.4.2",
        "window": {"width": 1920, "height": 1080, "fullscreen": False, "vsync": True},
        "audio": {"master_volume": 0.8, "sfx_volume": 0.7, "music_volume": 0.5, "muted": False},
        "graphics": {"quality": "high", "shadows": True, "anti_aliasing": "MSAA4x",
                     "texture_quality": "ultra", "draw_distance": 1000},
        "controls": {"mouse_sensitivity": 0.6, "invert_y": False, "key_forward": "W",
                     "key_back": "S", "key_left": "A", "key_right": "D", "key_jump": "Space"},
        "gameplay": {"difficulty": "normal", "auto_save": True, "tutorial": False},
        "network": {"server": "play.example.com", "port": 25565, "timeout": 30},
    }
    write("tiny_config.json", json.dumps(cfg, indent=2))

def gen_tiny_ini():
    """Classic .ini settings file — repetitive key=value structure."""
    lines = [
        "[Display]", "Width=1920", "Height=1080", "Fullscreen=0", "Borderless=0",
        "RefreshRate=60", "VSync=1", "AntiAlias=4", "TextureQuality=3",
        "", "[Audio]", "MasterVolume=80", "MusicVolume=60", "SFXVolume=75",
        "VoiceVolume=90", "Muted=0", "AudioDevice=default",
        "", "[Gameplay]", "Difficulty=2", "AutoSave=1", "SaveSlot=1",
        "Language=en_US", "Subtitles=0", "Tutorial=0",
        "", "[Controls]", "MouseSensitivity=6", "InvertY=0",
        "Forward=W", "Backward=S", "StrafeLeft=A", "StrafeRight=D",
        "Jump=Space", "Crouch=LCtrl", "Sprint=LShift", "Use=E",
        "Attack=LButton", "AltAttack=RButton", "Reload=R",
        "", "[Network]", "PlayerName=Player1", "ServerIP=", "ServerPort=25565",
        "MaxPing=200", "AutoConnect=0",
    ]
    write("game_settings.ini", "\n".join(lines))

def gen_tiny_lua():
    """Small Lua game script — typical modding/scripting file."""
    script = '''\
-- Game configuration script
local Config = {}

Config.VERSION = "2.1.0"
Config.DEBUG = false
Config.MAX_PLAYERS = 4

Config.PLAYER_DEFAULTS = {
    speed = 250,
    jump_force = 400,
    health = 100,
    lives = 3,
    invincible_time = 2.0,
}

Config.ENEMY_TYPES = {
    { name = "grunt",   hp = 20,  speed = 80,  score = 100 },
    { name = "scout",   hp = 10,  speed = 150, score = 150 },
    { name = "heavy",   hp = 80,  speed = 40,  score = 300 },
    { name = "boss",    hp = 500, speed = 60,  score = 1000 },
}

Config.LEVEL_PARAMS = {
    gravity = 980,
    tile_size = 32,
    chunk_size = 16,
    view_distance = 12,
}

function Config.get_difficulty_multiplier(level)
    if level <= 5 then return 1.0
    elseif level <= 10 then return 1.25
    elseif level <= 20 then return 1.75
    else return 2.5 end
end

return Config
'''
    write("game_config.lua", script)


# ─────────────────────────────────────────────────────────────────────────────
# ZSTD targets — medium structured text/binary 30-200 KB
# zstd wins with its FSE entropy coder on structured redundant data
# ─────────────────────────────────────────────────────────────────────────────

def gen_medium_json_data():
    """Game inventory/level data JSON ~100 KB — structured with repeated keys."""
    items = []
    item_types = ["sword", "shield", "potion", "armor", "helmet", "boots",
                  "ring", "amulet", "staff", "bow", "arrow", "bomb"]
    rarities = ["common", "uncommon", "rare", "epic", "legendary"]
    for i in range(800):
        items.append({
            "id": i + 1,
            "name": f"{random.choice(rarities).capitalize()} {random.choice(item_types).capitalize()} +{random.randint(0,10)}",
            "type": random.choice(item_types),
            "rarity": random.choice(rarities),
            "level_req": random.randint(1, 60),
            "stats": {
                "attack": random.randint(0, 200),
                "defense": random.randint(0, 150),
                "speed": random.randint(-20, 30),
                "magic": random.randint(0, 100),
            },
            "price": random.randint(10, 50000),
            "weight": round(random.uniform(0.1, 15.0), 2),
            "stackable": random.choice([True, False]),
            "description": f"A {random.choice(rarities)} item found in the dungeon depths.",
        })
    world = {
        "world_name": "Elderheim",
        "version": "0.9.4",
        "seed": random.randint(1, 999999),
        "items": items,
        "metadata": {"generated": "2026-03-01", "total_items": len(items)},
    }
    write("game_inventory_data.json", json.dumps(world, indent=2))

def gen_shader_glsl():
    """GLSL shader source code — structured, highly repetitive keywords."""
    shader = '''\
#version 450 core

// Physically Based Rendering - Fragment Shader
// CompressionAction test asset

layout(location = 0) in vec3 fragPos;
layout(location = 1) in vec3 fragNormal;
layout(location = 2) in vec2 fragTexCoord;
layout(location = 3) in vec3 fragTangent;
layout(location = 4) in vec3 fragBitangent;

layout(location = 0) out vec4 outColor;

layout(binding = 0) uniform sampler2D albedoMap;
layout(binding = 1) uniform sampler2D normalMap;
layout(binding = 2) uniform sampler2D metallicRoughnessMap;
layout(binding = 3) uniform sampler2D aoMap;
layout(binding = 4) uniform sampler2D emissiveMap;
layout(binding = 5) uniform samplerCube irradianceMap;
layout(binding = 6) uniform samplerCube prefilteredMap;
layout(binding = 7) uniform sampler2D brdfLUT;

layout(std140, binding = 0) uniform CameraUBO {
    mat4 view;
    mat4 projection;
    vec3 cameraPos;
    float padding;
} camera;

layout(std140, binding = 1) uniform LightUBO {
    vec3 lightPositions[4];
    vec3 lightColors[4];
    float lightIntensities[4];
    int numLights;
} lights;

const float PI = 3.14159265359;

vec3 getNormalFromMap() {
    vec3 tangentNormal = texture(normalMap, fragTexCoord).xyz * 2.0 - 1.0;
    vec3 Q1  = dFdx(fragPos);
    vec3 Q2  = dFdy(fragPos);
    vec2 st1 = dFdx(fragTexCoord);
    vec2 st2 = dFdy(fragTexCoord);
    vec3 N  = normalize(fragNormal);
    vec3 T  = normalize(Q1*st2.t - Q2*st1.t);
    vec3 B  = -normalize(cross(N, T));
    mat3 TBN = mat3(T, B, N);
    return normalize(TBN * tangentNormal);
}

float DistributionGGX(vec3 N, vec3 H, float roughness) {
    float a      = roughness * roughness;
    float a2     = a * a;
    float NdotH  = max(dot(N, H), 0.0);
    float NdotH2 = NdotH * NdotH;
    float num    = a2;
    float denom  = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;
    return num / denom;
}

float GeometrySchlickGGX(float NdotV, float roughness) {
    float r = (roughness + 1.0);
    float k = (r*r) / 8.0;
    float num   = NdotV;
    float denom = NdotV * (1.0 - k) + k;
    return num / denom;
}

float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
    float NdotV = max(dot(N, V), 0.0);
    float NdotL = max(dot(N, L), 0.0);
    float ggx2  = GeometrySchlickGGX(NdotV, roughness);
    float ggx1  = GeometrySchlickGGX(NdotL, roughness);
    return ggx1 * ggx2;
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

vec3 fresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness) {
    return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

void main() {
    vec3  albedo    = pow(texture(albedoMap, fragTexCoord).rgb, vec3(2.2));
    float metallic  = texture(metallicRoughnessMap, fragTexCoord).b;
    float roughness = texture(metallicRoughnessMap, fragTexCoord).g;
    float ao        = texture(aoMap, fragTexCoord).r;
    vec3  emissive  = texture(emissiveMap, fragTexCoord).rgb;

    vec3 N = getNormalFromMap();
    vec3 V = normalize(camera.cameraPos - fragPos);
    vec3 R = reflect(-V, N);

    vec3 F0 = vec3(0.04);
    F0 = mix(F0, albedo, metallic);

    vec3 Lo = vec3(0.0);
    for (int i = 0; i < lights.numLights; ++i) {
        vec3  L           = normalize(lights.lightPositions[i] - fragPos);
        vec3  H           = normalize(V + L);
        float distance    = length(lights.lightPositions[i] - fragPos);
        float attenuation = 1.0 / (distance * distance);
        vec3  radiance    = lights.lightColors[i] * lights.lightIntensities[i] * attenuation;

        float NDF = DistributionGGX(N, H, roughness);
        float G   = GeometrySmith(N, V, L, roughness);
        vec3  F   = fresnelSchlick(max(dot(H, V), 0.0), F0);

        vec3  kS          = F;
        vec3  kD          = vec3(1.0) - kS;
        kD               *= 1.0 - metallic;
        vec3  numerator   = NDF * G * F;
        float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
        vec3  specular    = numerator / denominator;

        float NdotL = max(dot(N, L), 0.0);
        Lo += (kD * albedo / PI + specular) * radiance * NdotL;
    }

    vec3 F  = fresnelSchlickRoughness(max(dot(N, V), 0.0), F0, roughness);
    vec3 kS = F;
    vec3 kD = 1.0 - kS;
    kD     *= 1.0 - metallic;

    vec3 irradiance = texture(irradianceMap, N).rgb;
    vec3 diffuse    = irradiance * albedo;

    const float MAX_REFLECTION_LOD = 4.0;
    vec3 prefilteredColor = textureLod(prefilteredMap, R, roughness * MAX_REFLECTION_LOD).rgb;
    vec2 brdf   = texture(brdfLUT, vec2(max(dot(N, V), 0.0), roughness)).rg;
    vec3 specular = prefilteredColor * (F * brdf.x + brdf.y);

    vec3 ambient = (kD * diffuse + specular) * ao;
    vec3 color   = ambient + Lo + emissive;

    // HDR tonemapping + gamma correction
    color = color / (color + vec3(1.0));
    color = pow(color, vec3(1.0 / 2.2));

    outColor = vec4(color, 1.0);
}
'''
    # Repeat ~5x to get to ~40KB — realistic for a shader with variants
    content = shader * 5
    write("pbr_fragment.glsl", content)

def gen_structured_xml():
    """Game map / level data in XML — highly repetitive tags, zstd loves this."""
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<level name="dungeon_01" version="2">',
             '  <metadata>', '    <author>LevelEditor v3.2</author>',
             '    <created>2026-01-15</created>', '    <tileset>dungeon_tiles_v2</tileset>',
             '  </metadata>', '  <layers>']
    # Tile layer — 64x64 grid of tile IDs
    lines.append('    <layer name="ground" type="tile" width="64" height="64">')
    lines.append('      <data>')
    tile_types = [0, 1, 1, 1, 2, 3, 4, 4, 4, 5]
    for row in range(64):
        row_data = ",".join(str(random.choice(tile_types)) for _ in range(64))
        lines.append(f"        {row_data}")
    lines.append('      </data>')
    lines.append('    </layer>')
    # Entity layer
    lines.append('    <layer name="entities" type="object">')
    entity_types = ["enemy_grunt", "enemy_archer", "chest", "torch", "door", "trigger"]
    for i in range(120):
        x = random.randint(0, 63) * 32
        y = random.randint(0, 63) * 32
        etype = random.choice(entity_types)
        lines.append(f'      <object id="{i+1}" type="{etype}" x="{x}" y="{y}">')
        lines.append(f'        <property name="hp" value="{random.randint(10,100)}"/>')
        drop = random.choice(["potion","key","none"])
        lines.append(f'        <property name="drops" value="coin,{drop}"/>')
        lines.append(f'      </object>')
    lines += ['    </layer>', '  </layers>', '</level>']
    write("level_map_data.xml", "\n".join(lines))

def gen_mixed_save_file():
    """Binary save file — mix of structured header + JSON metadata + binary state.
    Entropy ~5-6, zstd handles mixed content well."""
    # Header: magic + version + timestamp + player stats (binary)
    header = b'SAVE'  # magic
    header += struct.pack('<HH', 2, 1)         # version 2.1
    header += struct.pack('<I', 0x67A1B2C3)    # timestamp
    header += struct.pack('<fff', 128.5, 64.0, 0.0)   # player xyz
    header += struct.pack('<HHH', 85, 100, 42)         # hp, max_hp, level
    header += struct.pack('<I', 123456)                # gold
    header += struct.pack('<16I', *[random.randint(0, 255) for _ in range(16)])  # inventory slots

    # JSON metadata section
    meta = json.dumps({
        "player_name": "Hero",
        "playtime": 14520,
        "quests_completed": ["main_01", "main_02", "side_03", "side_07"],
        "achievements": ["first_blood", "explorer", "rich_guy"],
        "map_explored": {str(i): random.random() > 0.4 for i in range(200)},
    }).encode("utf-8")

    # Binary world state — repeating chunks of tile/entity data
    chunk_data = bytearray()
    for _ in range(300):
        # Each chunk: 8-byte header + 48 bytes of mixed data
        chunk_data += struct.pack('<BBHHI', 1, random.randint(0, 15),
                                  random.randint(0, 1023), random.randint(0, 1023),
                                  random.randint(0, 0xFFFF))
        chunk_data += bytes([random.randint(0, 20) for _ in range(48)])

    write("game_save_slot1.sav", header + meta + bytes(chunk_data))


# ─────────────────────────────────────────────────────────────────────────────
# BZIP2 targets — large repetitive data, long runs, Burrows-Wheeler thrives
# ─────────────────────────────────────────────────────────────────────────────

def gen_repeated_pattern():
    """Highly repetitive binary data — simulates uncompressed vertex buffer
    or voxel chunk data where most tiles are the same value."""
    patterns = [
        b'\x00' * 256,                         # null runs (empty space)
        b'\xFF\x00\xFF\x00' * 64,              # alternating
        b'\x01\x02\x03\x04' * 64,             # short cycle
        bytes(range(256)) * 1,                  # byte ramp
    ]
    data = bytearray()
    for _ in range(200):
        # Pick a pattern and write it with slight variation
        base = random.choice(patterns)
        data += base
        # Occasional noise byte to break perfect runs (more realistic)
        if random.random() < 0.05:
            data[-1] ^= random.randint(1, 3)
    # Pad to 1 MB
    while len(data) < 1024 * 1024:
        data += random.choice(patterns)
    write("vertex_buffer_repeated.bin", bytes(data[:1024 * 1024]))

def gen_large_source_code():
    """~300 KB of C-style game engine source — high symbol redundancy,
    bzip2's BWT excels on large structured text blocks."""
    keywords = ["void", "int", "float", "double", "char", "const", "static",
                "struct", "typedef", "if", "else", "for", "while", "return",
                "NULL", "true", "false", "bool", "unsigned", "sizeof"]
    types = ["Vector3", "Matrix4", "Quaternion", "Transform", "Mesh", "Texture",
             "Material", "Shader", "Camera", "Light", "Entity", "Component"]
    funcs = ["Initialize", "Update", "Render", "Destroy", "Load", "Save",
             "Serialize", "Deserialize", "Allocate", "Free", "Clone", "Copy"]

    lines = ["/* Auto-generated engine source for compression benchmarking */",
             "#include <engine/core.h>", "#include <engine/math.h>",
             "#include <engine/renderer.h>", "#include <engine/physics.h>", ""]

    for i in range(1800):
        t = random.choice(types)
        f = random.choice(funcs)
        lines.append(f"{random.choice(keywords)} {t}_{f}_{i}({t}* obj, {random.choice(types)}* ctx) {{")
        for _ in range(random.randint(4, 12)):
            indent = "    "
            stmt_type = random.randint(0, 4)
            if stmt_type == 0:
                lines.append(f"{indent}{random.choice(keywords)} {random.choice(types)} tmp_{i} = ({random.choice(types)}){{0}};")
            elif stmt_type == 1:
                lines.append(f"{indent}if (obj == NULL || ctx == NULL) return;")
            elif stmt_type == 2:
                lines.append(f"{indent}for ({random.choice(keywords)} i = 0; i < obj->count; ++i) {{")
                lines.append(f"{indent}    obj->data[i] = {random.choice(types)}_{random.choice(funcs)}(ctx);")
                lines.append(f"{indent}}}")
            elif stmt_type == 3:
                lines.append(f"{indent}obj->flags |= FLAG_{t.upper()}_{f.upper()};")
            else:
                lines.append(f"{indent}/* {random.choice(funcs)} {random.choice(types)} component */")
        lines.append("}")
        lines.append("")

    content = "\n".join(lines)
    # Trim or pad to ~300KB
    target = 300 * 1024
    if len(content) > target:
        content = content[:target]
    write("engine_source_large.c", content)

def gen_voxel_chunk():
    """Voxel world chunk data — block IDs with spatial locality.
    16x16x16 = 4096 bytes per chunk, 64 chunks = 256KB.
    Low entropy because most blocks are air (0) or common types."""
    AIR, STONE, DIRT, GRASS, WOOD, SAND = 0, 1, 2, 3, 4, 5
    chunks = bytearray()
    for _ in range(64):
        chunk = []
        for y in range(16):
            for x in range(16):
                for z in range(16):
                    if y < 4:    chunk.append(STONE)
                    elif y < 7:  chunk.append(DIRT if random.random() > 0.1 else STONE)
                    elif y == 7: chunk.append(GRASS if random.random() > 0.05 else DIRT)
                    elif y < 10: chunk.append(AIR if random.random() > 0.02 else WOOD)
                    else:        chunk.append(AIR)
        chunks += bytes(chunk)
    write("voxel_world_chunks.bin", bytes(chunks))


# ─────────────────────────────────────────────────────────────────────────────
# Additional WAD-adjacent binary formats
# ─────────────────────────────────────────────────────────────────────────────

def gen_synthetic_wad():
    """Minimal WAD-like archive with mixed lump types.
    Simulates small sector/vertex data (very compressible) mixed with
    pre-compressed texture data (high entropy)."""
    # WAD header: magic + lump count + dir offset
    lumps = {}

    # THINGS lump: 10-byte records, entity data (compressible)
    things = bytearray()
    for _ in range(200):
        things += struct.pack('<hhHHH',
            random.randint(-4096, 4096), random.randint(-4096, 4096),
            random.randint(0, 359), random.randint(1, 4096), 7)
    lumps['THINGS'] = bytes(things)

    # LINEDEFS lump: 14-byte records (compressible with repeating flags)
    linedefs = bytearray()
    for _ in range(300):
        linedefs += struct.pack('<HHHHHHH',
            random.randint(0, 199), random.randint(0, 199),
            random.choice([0, 1, 4, 16, 64]),
            0, random.randint(1, 10), 0xFFFF, 0xFFFF)
    lumps['LINEDEFS'] = bytes(linedefs)

    # SECTORS lump: 26-byte records (repetitive floor/ceiling heights)
    sectors = bytearray()
    for _ in range(80):
        sectors += struct.pack('<hh',
            random.randint(-16, 128),   # floor height
            random.randint(128, 256))   # ceiling height
        sectors += b'FLAT5_1 '          # floor texture (8 bytes)
        sectors += b'CEIL3_5 '          # ceiling texture (8 bytes)
        sectors += struct.pack('<HHH',
            random.randint(128, 255),   # light level
            random.randint(0, 9),       # special
            random.randint(0, 255))     # tag
    lumps['SECTORS'] = bytes(sectors)

    # TEXTURE1 lump: pre-compressed-like pixel data (high entropy)
    lumps['TEXTURE1'] = bytes([random.randint(0, 255) for _ in range(8192)])

    # Assemble WAD
    magic = b'PWAD'
    nlumps = len(lumps)
    lump_data = b''.join(lumps.values())
    dir_offset = 12 + len(lump_data)

    # Directory entries: 16 bytes each
    directory = bytearray()
    offset = 12
    for name, data in lumps.items():
        padded = name.encode('ascii')[:8].ljust(8, b'\x00')
        directory += struct.pack('<II', offset, len(data)) + padded
        offset += len(data)

    wad = magic + struct.pack('<II', nlumps, dir_offset) + lump_data + bytes(directory)
    write("synthetic_map.wad", wad)


# ─────────────────────────────────────────────────────────────────────────────
# Summary helper
# ─────────────────────────────────────────────────────────────────────────────

def show_entropy_summary():
    import math
    def entropy(path):
        with open(path, 'rb') as f:
            data = f.read(65536)
        if not data: return 0.0
        freq = [0] * 256
        for b in data: freq[b] += 1
        total = len(data)
        return -sum((c/total)*math.log2(c/total) for c in freq if c > 0)

    print()
    print(f"{'File':<48} {'Size KB':>8}  {'Entropy':>8}  Expected winner")
    print("-" * 90)
    expected = {
        "random_binary_512kb.bin":       "lz4",
        "noise_texture_256x256_rgba.raw":"lz4",
        "precompressed_asset.bin":       "lz4",
        "audio_pcm_44100hz_1sec.raw":    "lz4",
        "tiny_config.json":              "gzip",
        "game_settings.ini":             "gzip",
        "game_config.lua":               "gzip",
        "game_inventory_data.json":      "zstd",
        "pbr_fragment.glsl":             "zstd",
        "level_map_data.xml":            "zstd",
        "game_save_slot1.sav":           "zstd",
        "vertex_buffer_repeated.bin":    "bzip2",
        "engine_source_large.c":         "bzip2",
        "voxel_world_chunks.bin":        "bzip2",
        "synthetic_map.wad":             "xz/bzip2",
    }
    for fname, pred in expected.items():
        path = os.path.join(OUT_DIR, fname)
        if os.path.exists(path):
            e = entropy(path)
            size = os.path.getsize(path) / 1024
            print(f"  {fname:<46} {size:>8.1f}  {e:>8.3f}  {pred}")


if __name__ == "__main__":
    print(f"Generating synthetic game assets → {OUT_DIR}")
    print()
    print("LZ4 targets (high entropy):")
    gen_random_binary()
    gen_noise_texture_rgba()
    gen_already_compressed_blob()
    gen_audio_pcm()

    print("\nGZIP targets (tiny text):")
    gen_tiny_json_config()
    gen_tiny_ini()
    gen_tiny_lua()

    print("\nZSTD targets (medium structured):")
    gen_medium_json_data()
    gen_shader_glsl()
    gen_structured_xml()
    gen_mixed_save_file()

    print("\nBZIP2 targets (large repetitive):")
    gen_repeated_pattern()
    gen_large_source_code()
    gen_voxel_chunk()

    print("\nMixed targets:")
    gen_synthetic_wad()

    show_entropy_summary()

    print()
    print("Done. Run each file through the CompressAction app to generate benchmark CSVs.")
    print("Then re-run ML_compression_model_v3.R to retrain with the expanded dataset.")