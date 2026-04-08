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
