// Получение элементов из DOM
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const playerScoreElement = document.getElementById('player-score');
const aiScoreElement = document.getElementById('ai-score');
const roundMessageElement = document.getElementById('round-message');
const startButtonElement = document.getElementById('start-button');
const countdownElement = document.getElementById('countdown');
const connectionStatusElement = document.getElementById('connection-status');
const createGameButton = document.getElementById('create-game');
const joinGameButton = document.getElementById('join-game');
const joinCodeInput = document.getElementById('join-code');
const gameCodeDisplay = document.getElementById('game-code');
const inviteBox = document.getElementById('invite-box');
const copyCodeButton = document.getElementById('copy-code');

// Параметры игры
const params = {
    restitution: 0.8,    // Сила отталкивания
    mass: 7,             // Инерция (масса)
    friction: 0.07,      // Трение
    maxDashPower: 30,    // Максимальная сила рывка
    dashCooldown: 0.7,   // Кулдаун рывка в секундах
    playerSize: 40,      // Размер игроков в пикселях
    dashChargeRate: 2.5, // Скорость накопления рывка
    ghostDuration: 0.5,  // Длительность исчезновения в секундах
    ghostCooldown: 2.0   // Кулдаун исчезновения в секундах
};

// Состояние игры
const INTERPOLATION_DELAY = 100; // milliseconds

const game = {
    arenaRadius: 250,
    playerRadius: 40,
    aiRadius: 40,
    player: {
        x: -80,
        y: 0,
        vx: 0,
        vy: 0,
        dashCooldown: 0,
        isDashing: false,
        dashPower: 0,
        dashCharging: false,
        ghostActive: false,
        ghostCooldown: 0,
        displayX: -80, 
        displayY: 0,
        stateBuffer: []
    },
    ai: {  // теперь это второй игрок
        x: 80,
        y: 0,
        displayX: 80, 
        displayY: 0,
        stateBuffer: [],
        vx: 0,
        vy: 0,
        dashCooldown: 0,
        isDashing: false,
        dashPower: 0,
        dashCharging: false,
        ghostActive: false,
        ghostCooldown: 0
    },
    mouse: {
        x: 0,
        y: 0
    },
    playerScore: 0,
    aiScore: 0,
    round: 1,
    maxRounds: 3,
    gameOver: false,
    roundActive: false,
    roundEndTime: 0,
    countdownActive: false,
    countdownValue: 0,
    waitingForStart: true,
    
    // Настройки сети
    isNetworkGame: false,
    isHost: false,
    isPlayer2: false,
    gameId: null,
    socket: null,
    connected: false
};

// Обновление значений ползунков
document.querySelectorAll('.controls input[type="range"]').forEach(input => {
    // Обновление начального значения
    document.getElementById(`${input.id}-value`).textContent = input.value;
    
    // Обновление при изменении
    input.addEventListener('input', () => {
        const value = parseFloat(input.value);
        document.getElementById(`${input.id}-value`).textContent = value;
        params[input.id] = value;
        
        // Отправка обновленных параметров через сеть, если это хост
        if (game.isNetworkGame && game.isHost && game.socket && game.socket.readyState === WebSocket.OPEN) {
            game.socket.send(JSON.stringify({
                type: 'update_params',
                params: params
            }));
        }
    });
});

// Функции сетевого взаимодействия
function connectToServer() {
    const serverUrl = window.location.hostname === 'localhost' ? 
        'ws://localhost:3000' : 
        `wss://${window.location.host}`;
    
    game.socket = new WebSocket(serverUrl);
    
    updateConnectionStatus('Подключение к серверу...', 'waiting');
    
    game.socket.onopen = function() {
        console.log('Подключено к серверу');
        updateConnectionStatus('Подключено к серверу', 'connected');
        game.connected = true;
    };
    
    game.socket.onclose = function() {
        console.log('Соединение с сервером закрыто');
        updateConnectionStatus('Соединение с сервером закрыто', 'error');
        game.connected = false;
        game.isNetworkGame = false;
    };
    
    game.socket.onerror = function(error) {
        console.error('Ошибка WebSocket:', error);
        updateConnectionStatus('Ошибка подключения к серверу', 'error');
        game.connected = false;
    };
    
    game.socket.onmessage = function(event) {
        try {
            const message = JSON.parse(event.data);
            handleNetworkMessage(message);
        } catch (e) {
            console.error('Ошибка обработки сообщения:', e);
        }
    };
}

function updateConnectionStatus(text, className) {
    connectionStatusElement.textContent = text;
    connectionStatusElement.className = 'connection-status ' + (className || '');
}

function handleNetworkMessage(message) {
    switch (message.type) {
        case 'game_created':
            game.gameId = message.gameId;
            game.isHost = true;
            game.isNetworkGame = true;
            gameCodeDisplay.textContent = message.gameId;
            inviteBox.style.display = 'block';
            updateConnectionStatus('Ожидание второго игрока...', 'waiting');
            break;
            
        case 'player_joined':
            if (game.isHost) {
                updateConnectionStatus('Второй игрок подключился!', 'connected');
                startButtonElement.style.display = 'block';
                startButtonElement.textContent = 'Начать игру';
                // Отправляем текущие параметры игры
                game.socket.send(JSON.stringify({
                    type: 'update_params',
                    params: params
                }));
            }
            break;
            
        case 'game_joined':
            game.gameId = message.gameId;
            game.isPlayer2 = true;
            game.isNetworkGame = true;
            updateConnectionStatus('Вы подключились к игре! Ожидание начала...', 'connected');
            break;
            
        case 'game_not_found':
            updateConnectionStatus('Игра не найдена. Проверьте код.', 'error');
            break;
            
        case 'start_game':
            if (game.isPlayer2) {
                startCountdown();
            }
            break;
            
        case 'update_params':
            // Обновление параметров игры от хоста
            if (game.isPlayer2) {
                Object.keys(message.params).forEach(key => {
                    params[key] = message.params[key];
                    if (document.getElementById(`${key}-value`)) {
                        document.getElementById(`${key}-value`).textContent = params[key];
                        document.getElementById(key).value = params[key];
                    }
                });
            }
            break;
            
        case 'game_state':
            let remotePlayerToUpdate;
            if (game.isPlayer2) { // This client is Player 2, so game.player is remote
                remotePlayerToUpdate = game.player;
            } else if (game.isHost) { // This client is Host, so game.ai is remote
                remotePlayerToUpdate = game.ai;
            }

            if (remotePlayerToUpdate) {
                // First, push to stateBuffer for interpolation
                remotePlayerToUpdate.stateBuffer.push({
                    timestamp: Date.now(),
                    x: message.player.x,
                    y: message.player.y,
                    vx: message.player.vx,
                    vy: message.player.vy
                });
                if (remotePlayerToUpdate.stateBuffer.length > 20) {
                    remotePlayerToUpdate.stateBuffer.shift();
                }

                // Then, call updatePlayerFromNetwork to update the core properties
                // (including x, y, vx, vy for physics)
                updatePlayerFromNetwork(remotePlayerToUpdate, message.player);
            }
            break;
            
        case 'round_result':
            handleRoundResult(message);
            break;
            
        case 'opponent_disconnected':
            updateConnectionStatus('Соперник отключился', 'error');
            game.roundActive = false;
            startButtonElement.style.display = 'none';
            break;
    }
}

function updatePlayerFromNetwork(localPlayer, networkPlayer) {
    localPlayer.x = networkPlayer.x;
    localPlayer.y = networkPlayer.y;
    localPlayer.vx = networkPlayer.vx;
    localPlayer.vy = networkPlayer.vy;
    localPlayer.dashCooldown = networkPlayer.dashCooldown;
    localPlayer.isDashing = networkPlayer.isDashing;
    localPlayer.dashPower = networkPlayer.dashPower;
    localPlayer.dashCharging = networkPlayer.dashCharging;
    localPlayer.ghostActive = networkPlayer.ghostActive;
    localPlayer.ghostCooldown = networkPlayer.ghostCooldown;
}

function sendPlayerState() {
    if (!game.isNetworkGame || !game.socket || game.socket.readyState !== WebSocket.OPEN || !game.gameId) 
        return;
    
    const playerToSend = game.isHost ? game.player : game.ai;
    
    game.socket.send(JSON.stringify({
        type: 'player_state',
        gameId: game.gameId,
        player: playerToSend
    }));
}

function handleRoundResult(message) {
    game.playerScore = message.blueScore;
    game.aiScore = message.redScore;
    playerScoreElement.textContent = game.playerScore;
    aiScoreElement.textContent = game.aiScore;
    game.round = message.nextRound;
    
    roundMessageElement.textContent = message.message;
    game.roundActive = false;
    game.waitingForStart = true;
    
    // Показываем кнопку старта только хосту
    if (game.isHost) {
        if (message.gameOver) {
            startButtonElement.textContent = "Начать новую игру";
            startButtonElement.style.display = "block";
            startButtonElement.onclick = () => {
                game.playerScore = 0;
                game.aiScore = 0;
                game.round = 1;
                playerScoreElement.textContent = "0";
                aiScoreElement.textContent = "0";
                startButtonElement.onclick = sendStartGame;
                sendStartGame();
            };
        } else {
            startButtonElement.textContent = "Начать раунд " + game.round;
            startButtonElement.style.display = "block";
        }
    }
}

// Инициализация сетевых кнопок
createGameButton.addEventListener('click', () => {
    if (!game.connected) {
        connectToServer();
        
        // Ожидаем подключения к серверу
        const checkConnection = setInterval(() => {
            if (game.connected) {
                clearInterval(checkConnection);
                createGame();
            }
        }, 100);
    } else {
        createGame();
    }
});

// Функция активации режима исчезновения
function activateGhost(entity) {
    entity.ghostActive = true;
    entity.ghostCooldown = params.ghostCooldown * 60; // Преобразуем секунды в кадры
    
    // Сброс рывка и запуск его кулдауна
    entity.dashCharging = false;
    entity.dashPower = 0;
    entity.dashCooldown = params.dashCooldown * 60;
    
    // Устанавливаем таймер для деактивации призрачного режима
    setTimeout(() => {
        deactivateGhost(entity);
    }, params.ghostDuration * 1000);
}

// Функция деактивации режима исчезновения
function deactivateGhost(entity) {
    if (entity.ghostActive) {
        entity.ghostActive = false;
        
        // Проверяем, есть ли перекрытие с другим игроком
        const otherEntity = entity === game.player ? game.ai : game.player;
        const dx = otherEntity.x - entity.x;
        const dy = otherEntity.y - entity.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = game.playerRadius + game.aiRadius;
        
        if (distance < minDistance) {
            // Небольшое отталкивание при перекрытии
            const nx = dx / distance;
            const ny = dy / distance;
            const repelForce = 5; // Небольшая сила отталкивания
            
            entity.vx -= nx * repelForce;
            entity.vy -= ny * repelForce;
            otherEntity.vx += nx * repelForce;
            otherEntity.vy += ny * repelForce;
        }
    }
}

// Обновление физики
function updatePhysics() {
    if (!game.roundActive) return;
    
    // Синхронизация размеров игроков с настройками
    game.playerRadius = params.playerSize;
    game.aiRadius = params.playerSize;
    
    // Обновление заряда рывка игроков
    if (game.isNetworkGame) {
        // В сетевой игре обновляем только своего игрока
        if (game.isHost) {
            updatePlayerPhysics(game.player);
        } else if (game.isPlayer2) {
            updatePlayerPhysics(game.ai);
        }
        
        // Отправляем состояние через сеть
        sendPlayerState();
    } else {
        // В локальной игре обновляем обоих
        updatePlayerPhysics(game.player);
        updatePlayerPhysics(game.ai);
    }
    
    // Проверка столкновения между игроками только если оба не в режиме призрака
    if (!game.player.ghostActive && !game.ai.ghostActive) {
        const dx = game.ai.x - game.player.x;
        const dy = game.ai.y - game.player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = game.playerRadius + game.aiRadius;
        
        if (distance < minDistance) {
            // Нормализованный вектор столкновения
            const nx = dx / distance;
            const ny = dy / distance;
            
            // Относительная скорость
            const dvx = game.ai.vx - game.player.vx;
            const dvy = game.ai.vy - game.player.vy;
            
            // Проекция относительной скорости на вектор столкновения
            const dp = dvx * nx + dvy * ny;
            
            // Если объекты движутся друг к другу
            if (dp < 0) {
                // Импульс с учетом массы и отскока
                const impulse = (-(1 + params.restitution) * dp) / (2 / params.mass);
                
                // Применение импульса к скоростям
                game.player.vx -= impulse * nx / params.mass;
                game.player.vy -= impulse * ny / params.mass;
                game.ai.vx += impulse * nx / params.mass;
                game.ai.vy += impulse * ny / params.mass;
            }
            
            // Корректировка позиций, чтобы избежать перекрытия
            const overlap = minDistance - distance;
            const correction = overlap / 2;
            game.player.x -= nx * correction;
            game.player.y -= ny * correction;
            game.ai.x += nx * correction;
            game.ai.y += ny * correction;
        }
    }
    
    // Проверка выхода за пределы арены
    const playerDistToCenter = Math.sqrt(game.player.x * game.player.x + game.player.y * game.player.y);
    const aiDistToCenter = Math.sqrt(game.ai.x * game.ai.x + game.ai.y * game.ai.y);
    
    // Проверка условия завершения раунда
    if (game.roundActive) {
        if (playerDistToCenter > game.arenaRadius + game.playerRadius) {
            // Красный выиграл раунд
            game.aiScore++;
            aiScoreElement.textContent = game.aiScore;
            endRound("Красный игрок выиграл раунд!");
        } else if (aiDistToCenter > game.arenaRadius + game.aiRadius) {
            // Синий выиграл раунд
            game.playerScore++;
            playerScoreElement.textContent = game.playerScore;
            endRound("Синий игрок выиграл раунд!");
        }
    }
}

// Обновление физики для одного игрока
function updatePlayerPhysics(player) {
    // Обновление заряда рывка
    if (player.dashCharging && player.dashPower < 1) {
        player.dashPower += 0.017 * params.dashChargeRate;
        if (player.dashPower > 1) player.dashPower = 1;
    }
    
    // Обновление кулдаунов
    if (player.dashCooldown > 0) {
        player.dashCooldown--;
    }
    if (player.dashCooldown <= 0) {
        player.isDashing = false;
    }
    
    if (player.ghostCooldown > 0) {
        player.ghostCooldown--;
    }
    
    // Применение трения
    player.vx *= (1 - params.friction);
    player.vy *= (1 - params.friction);
    
    // Обновление позиций
    player.x += player.vx;
    player.y += player.vy;
}

// Функция для отрисовки полоски прогресса
function drawProgressBar(x, y, width, height, progress, color) {
    ctx.beginPath();
    ctx.rect(x - width / 2, y - height / 2, width, height);
    ctx.fillStyle = '#444';
    ctx.fill();
    
    ctx.beginPath();
    ctx.rect(x - width / 2, y - height / 2, width * progress, height);
    ctx.fillStyle = color;
    ctx.fill();
    
    ctx.beginPath();
    ctx.rect(x - width / 2, y - height / 2, width, height);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
}

// Отрисовка игры
function render() {
    // Очистка холста
    // Очистка холста
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);

    // Determine draw positions for player (Blue)
    let playerDrawX = game.player.x;
    let playerDrawY = game.player.y;
    if (game.isNetworkGame && game.isPlayer2) { // This client is P2, game.player is the HOST (remote)
        interpolatePlayerPosition(game.player);
        playerDrawX = game.player.displayX;
        playerDrawY = game.player.displayY;
    }

    // Determine draw positions for ai (Red)
    let aiDrawX = game.ai.x;
    let aiDrawY = game.ai.y;
    if (game.isNetworkGame && game.isHost) { // This client is Host, game.ai is P2 (remote)
        interpolatePlayerPosition(game.ai);
        aiDrawX = game.ai.displayX;
        aiDrawY = game.ai.displayY;
    }
    
    // Отрисовка фона арены
    ctx.beginPath();
    ctx.arc(0, 0, game.arenaRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#222';
    ctx.fill();
    
    // Отрисовка границы арены
    ctx.beginPath();
    ctx.arc(0, 0, game.arenaRadius, 0, Math.PI * 2);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Отрисовка линии направления для игрока
    if (game.roundActive) {
        // Для первого игрока (синего)
        if ((!game.isNetworkGame || game.isHost) && !game.player.ghostActive) { 
            ctx.beginPath();
            ctx.moveTo(playerDrawX, playerDrawY); // Use draw positions
            const angle = Math.atan2(game.mouse.y - playerDrawY, game.mouse.x - playerDrawX);
            const lineLength = 30 + game.player.dashPower * 30;
            ctx.lineTo(
                playerDrawX + Math.cos(angle) * lineLength,
                playerDrawY + Math.sin(angle) * lineLength
            );
            ctx.strokeStyle = game.player.dashCharging ? '#22aaff' : '#0066cc';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        
        // Для второго игрока (красного)
        // This logic is for the player who controls the red entity (either local P2, or local AI)
        const redPlayerEntity = game.isNetworkGame && game.isPlayer2 ? game.ai : game.ai; // game.ai is local for P2
        const redPlayerDrawX = game.isNetworkGame && game.isPlayer2 ? aiDrawX : aiDrawX; // if P2, ai is local
        const redPlayerDrawY = game.isNetworkGame && game.isPlayer2 ? aiDrawY : aiDrawY; // if P2, ai is local

        if ((!game.isNetworkGame || game.isPlayer2) && !redPlayerEntity.ghostActive) { 
            if (game.isNetworkGame && game.isPlayer2) { // Network game, this client is P2 (controls red)
                 ctx.beginPath();
                 ctx.moveTo(redPlayerDrawX, redPlayerDrawY);
                 const angle = Math.atan2(game.mouse.y - redPlayerDrawY, game.mouse.x - redPlayerDrawX);
                 const lineLength = 30 + redPlayerEntity.dashPower * 30;
                 ctx.lineTo(
                     redPlayerDrawX + Math.cos(angle) * lineLength,
                     redPlayerDrawY + Math.sin(angle) * lineLength
                 );
                 ctx.strokeStyle = redPlayerEntity.dashCharging ? '#ff4444' : '#cc0000';
                 ctx.lineWidth = 2;
                 ctx.stroke();
            } else if (!game.isNetworkGame && !game.ai.ghostActive) { 
                // Local game, AI (red) does not show mouse-based aiming line. 
                // Or add AI aiming logic here if desired.
            }
        }
    }
    
    // ===== ОТРИСОВКА ИГРОКА =====
    ctx.beginPath();
    ctx.arc(playerDrawX, playerDrawY, game.playerRadius, 0, Math.PI * 2); // Use draw positions
    
    // Выбор цвета игрока в зависимости от режима
    if (game.player.ghostActive) {
        // В режиме исчезновения - черный
        ctx.fillStyle = '#000000';
        ctx.strokeStyle = '#222222';
    } else {
        // Обычное состояние - синий
        ctx.fillStyle = '#22aaff';
        ctx.strokeStyle = '#0066cc';
    }
    
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // ===== ОТРИСОВКА ВТОРОГО ИГРОКА =====
    ctx.beginPath();
    ctx.arc(aiDrawX, aiDrawY, game.aiRadius, 0, Math.PI * 2); // Use draw positions
    
    // Выбор цвета в зависимости от режима
    if (game.ai.ghostActive) {
        // В режиме исчезновения - черный
        ctx.fillStyle = '#000000';
        ctx.strokeStyle = '#222222';
    } else {
        // Обычное состояние - красный
        ctx.fillStyle = '#ff4444';
        ctx.strokeStyle = '#cc0000';
    }
    
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // ===== ИНДИКАТОРЫ КУЛДАУНОВ =====
    // Полоски прогресса над игроками для наглядной индикации кулдаунов
    
    // Индикаторы для первого игрока
    if (!game.player.ghostActive) {
        // Индикатор кулдауна рывка (оранжевый)
        if (game.player.dashCooldown > 0) {
            const dashProgress = 1 - game.player.dashCooldown / (params.dashCooldown * 60);
            drawProgressBar(playerDrawX, playerDrawY - game.playerRadius - 10, 
                           game.playerRadius * 2, 5, dashProgress, '#ff9900');
        }
        
        // Индикатор зарядки рывка (зеленый)
        if (game.player.dashCharging) {
            drawProgressBar(playerDrawX, playerDrawY - game.playerRadius - 10, 
                           game.playerRadius * 2, 5, game.player.dashPower, '#00ff88');
        }
        
        // Индикатор кулдауна исчезновения (пурпурный)
        if (game.player.ghostCooldown > 0) {
            const ghostProgress = 1 - game.player.ghostCooldown / (params.ghostCooldown * 60);
            drawProgressBar(playerDrawX, playerDrawY - game.playerRadius - 18, 
                           game.playerRadius * 2, 5, ghostProgress, '#cc44ff');
        }
    }
    
    // Индикаторы для второго игрока
    if (!game.ai.ghostActive) {
        // Индикатор кулдауна рывка (оранжевый)
        if (game.ai.dashCooldown > 0) {
            const dashProgress = 1 - game.ai.dashCooldown / (params.dashCooldown * 60);
            drawProgressBar(aiDrawX, aiDrawY - game.aiRadius - 10, 
                          game.aiRadius * 2, 5, dashProgress, '#ff9900');
        }
        
        // Индикатор зарядки рывка (зеленый)
        if (game.ai.dashCharging) {
            drawProgressBar(aiDrawX, aiDrawY - game.aiRadius - 10, 
                          game.aiRadius * 2, 5, game.ai.dashPower, '#00ff88');
        }
        
        // Индикатор кулдауна исчезновения (пурпурный)
        if (game.ai.ghostCooldown > 0) {
            const ghostProgress = 1 - game.ai.ghostCooldown / (params.ghostCooldown * 60);
            drawProgressBar(aiDrawX, aiDrawY - game.aiRadius - 18, 
                          game.aiRadius * 2, 5, ghostProgress, '#cc44ff');
        }
    }
    
    ctx.restore();
}

function interpolatePlayerPosition(player) {
    const now = Date.now();
    const renderTimestamp = now - INTERPOLATION_DELAY;

    const buffer = player.stateBuffer;

    // Find two states in the buffer to interpolate between
    let state1 = null;
    let state2 = null;

    for (let i = buffer.length - 1; i >= 0; i--) {
        if (buffer[i].timestamp <= renderTimestamp) {
            state1 = buffer[i];
            if (i + 1 < buffer.length) {
                state2 = buffer[i+1];
            }
            break;
        }
    }

    if (state1 && state2) {
        const t = (renderTimestamp - state1.timestamp) / (state2.timestamp - state1.timestamp);
        // Ensure t is between 0 and 1
        const clampedT = Math.max(0, Math.min(1, t)); 
        
        player.displayX = state1.x + (state2.x - state1.x) * clampedT;
        player.displayY = state1.y + (state2.y - state1.y) * clampedT;
    } else if (state1) { // Not enough history to interpolate, or renderTimestamp is too old
        player.displayX = state1.x;
        player.displayY = state1.y;
    } else if (buffer.length > 0) { 
        const targetState = buffer[buffer.length -1]; 
        player.displayX = targetState.x;
        player.displayY = targetState.y;
    }
    else { 
       player.displayX = player.x; 
       player.displayY = player.y;
    }
}

// Основной игровой цикл
function gameLoop() {
    updatePhysics();
    render();
    requestAnimationFrame(gameLoop);
}

// Инициализация и запуск игры
initGame();
gameLoop();

// Завершение раунда
function endRound(message) {
    game.roundActive = false;
    game.waitingForStart = true;
    game.roundEndTime = Date.now();
    
    if (game.isNetworkGame) {
        // В сетевой игре отправляем результат раунда
        if (game.socket && game.socket.readyState === WebSocket.OPEN && game.gameId) {
            let gameOver = false;
            
            // Проверка завершения игры
            if (game.round >= game.maxRounds || Math.max(game.playerScore, game.aiScore) > Math.floor(game.maxRounds / 2)) {
                gameOver = true;
                if (game.playerScore > game.aiScore) {
                    message = "Синий игрок выиграл игру!";
                } else {
                    message = "Красный игрок выиграл игру!";
                }
            }
            
            game.socket.send(JSON.stringify({
                type: 'round_end',
                gameId: game.gameId,
                blueScore: game.playerScore,
                redScore: game.aiScore,
                message: message,
                nextRound: gameOver ? 1 : game.round + 1,
                gameOver: gameOver
            }));
        }
    } else {
        // Локальная игра
        roundMessageElement.textContent = message;
        
        // Проверка завершения игры
        if (game.round >= game.maxRounds || Math.max(game.playerScore, game.aiScore) > Math.floor(game.maxRounds / 2)) {
            if (game.playerScore > game.aiScore) {
                roundMessageElement.textContent = "Синий игрок выиграл игру!";
            } else {
                roundMessageElement.textContent = "Красный игрок выиграл игру!";
            }
            
            // Подготовка к новой игре
            startButtonElement.textContent = "Начать новую игру";
            startButtonElement.style.display = "block";
            startButtonElement.onclick = () => {
                game.playerScore = 0;
                game.aiScore = 0;
                game.round = 1;
                playerScoreElement.textContent = "0";
                aiScoreElement.textContent = "0";
                startButtonElement.onclick = startCountdown; // Возвращаем обычный обработчик
                startCountdown();
            };
        } else {
            // Подготовка к следующему раунду
            game.round++;
            startButtonElement.textContent = "Начать раунд " + game.round;
            startButtonElement.style.display = "block";
        }
    }
}

joinGameButton.addEventListener('click', () => {
    const code = joinCodeInput.value.trim();
    if (!code) {
        alert('Пожалуйста, введите код игры');
        return;
    }
    
    if (!game.connected) {
        connectToServer();
        
        // Ожидаем подключения к серверу
        const checkConnection = setInterval(() => {
            if (game.connected) {
                clearInterval(checkConnection);
                joinGame(code);
            }
        }, 100);
    } else {
        joinGame(code);
    }
});

copyCodeButton.addEventListener('click', () => {
    navigator.clipboard.writeText(game.gameId).then(() => {
        copyCodeButton.textContent = 'Скопировано!';
        setTimeout(() => {
            copyCodeButton.textContent = 'Копировать';
        }, 2000);
    });
});

function createGame() {
    if (game.socket && game.socket.readyState === WebSocket.OPEN) {
        game.socket.send(JSON.stringify({
            type: 'create_game'
        }));
    }
}

function joinGame(gameId) {
    if (game.socket && game.socket.readyState === WebSocket.OPEN) {
        game.socket.send(JSON.stringify({
            type: 'join_game',
            gameId: gameId
        }));
    }
}

function sendStartGame() {
    if (game.isHost && game.socket && game.socket.readyState === WebSocket.OPEN) {
        game.socket.send(JSON.stringify({
            type: 'start_game',
            gameId: game.gameId
        }));
        startCountdown();
    }
}

// Инициализация кнопки запуска
startButtonElement.addEventListener('click', () => {
    if (game.isNetworkGame) {
        sendStartGame();
    } else {
        startCountdown();
    }
});

// Функция запуска обратного отсчета
function startCountdown() {
    startButtonElement.style.display = 'none';
    game.countdownActive = true;
    game.countdownValue = 3;
    countdownElement.textContent = game.countdownValue;
    countdownElement.style.display = 'block';
    
    const countdownInterval = setInterval(() => {
        game.countdownValue--;
        if (game.countdownValue > 0) {
            countdownElement.textContent = game.countdownValue;
        } else {
            clearInterval(countdownInterval);
            countdownElement.style.display = 'none';
            game.countdownActive = false;
            startRound();
        }
    }, 1000);
}

// Функция запуска раунда
function startRound() {
    // Обновление размеров игроков на основе ползунка
    game.playerRadius = params.playerSize;
    game.aiRadius = params.playerSize;
    
    // Сброс положения игроков
    game.player.x = -80;
    game.player.x = -80;
    game.player.y = 0;
    game.player.vx = 0;
    game.player.vy = 0;
    game.player.dashCooldown = 0;
    game.player.isDashing = false;
    game.player.dashPower = 0;
    game.player.dashCharging = false;
    game.player.ghostActive = false;
    game.player.ghostCooldown = 0;
    game.player.displayX = -80; 
    game.player.displayY = 0;
    game.player.stateBuffer = []; 
    
    game.ai.x = 80;
    game.ai.y = 0;
    game.ai.vx = 0;
    game.ai.vy = 0;
    game.ai.dashCooldown = 0;
    game.ai.isDashing = false;
    game.ai.dashPower = 0;
    game.ai.dashCharging = false;
    game.ai.ghostActive = false;
    game.ai.ghostCooldown = 0;
    game.ai.displayX = 80; 
    game.ai.displayY = 0;
    game.ai.stateBuffer = []; 
    
    game.roundActive = true;
    game.waitingForStart = false;
    roundMessageElement.textContent = `Раунд ${game.round}`;
}

// Инициализация игры
function initGame() {
    // Показать кнопку старта (только для локальной игры)
    if (!game.isNetworkGame) {
        startButtonElement.style.display = 'block';
        startButtonElement.textContent = game.round === 1 ? 'Начать игру' : 'Начать раунд';
    }
    
    game.waitingForStart = true;
    roundMessageElement.textContent = `Раунд ${game.round}`;
}

// Обработка ввода игрока
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    game.mouse.x = e.clientX - rect.left - canvas.width / 2;
    game.mouse.y = e.clientY - rect.top - canvas.height / 2;
});

document.addEventListener('keydown', (e) => {
    if (!game.roundActive) return;
    
    if (game.isNetworkGame) {
        // В сетевой игре обрабатываем ввод соответствующего игрока
        if (game.isHost && e.code === 'Space' && !game.player.dashCharging && game.player.dashCooldown <= 0 && !game.player.ghostActive) {
            game.player.dashCharging = true;
            game.player.dashPower = 0;
        } else if (game.isHost && e.code === 'KeyD' && game.player.ghostCooldown <= 0) {
            activateGhost(game.player);
        } else if (game.isPlayer2 && e.code === 'Space' && !game.ai.dashCharging && game.ai.dashCooldown <= 0 && !game.ai.ghostActive) {
            game.ai.dashCharging = true;
            game.ai.dashPower = 0;
        } else if (game.isPlayer2 && e.code === 'KeyD' && game.ai.ghostCooldown <= 0) {
            activateGhost(game.ai);
        }
    } else {
        // В локальной игре обрабатываем только первого игрока
        if (e.code === 'Space' && !game.player.dashCharging && game.player.dashCooldown <= 0 && !game.player.ghostActive) {
            game.player.dashCharging = true;
            game.player.dashPower = 0;
        } else if (e.code === 'KeyD' && game.player.ghostCooldown <= 0) {
            activateGhost(game.player);
        }
    }
});

document.addEventListener('keyup', (e) => {
    if (!game.roundActive) return;
    
    if (game.isNetworkGame) {
        // В сетевой игре обрабатываем отпускание клавиш для соответствующего игрока
        if (game.isHost && e.code === 'Space' && game.player.dashCharging) {
            game.player.dashCharging = false;
            game.player.isDashing = true;
            // Конвертируем секунды в кадры (60 FPS)
            game.player.dashCooldown = params.dashCooldown * 60;
            
            // Расчет вектора рывка
            const angle = Math.atan2(game.mouse.y - game.player.y, game.mouse.x - game.player.x);
            const dashSpeed = game.player.dashPower * params.maxDashPower;
            
            game.player.vx += Math.cos(angle) * dashSpeed;
            game.player.vy += Math.sin(angle) * dashSpeed;
        } else if (game.isPlayer2 && e.code === 'Space' && game.ai.dashCharging) {
            game.ai.dashCharging = false;
            game.ai.isDashing = true;
            // Конвертируем секунды в кадры (60 FPS)
            game.ai.dashCooldown = params.dashCooldown * 60;
            
            // Расчет вектора рывка
            const angle = Math.atan2(game.mouse.y - game.ai.y, game.mouse.x - game.ai.x);
            const dashSpeed = game.ai.dashPower * params.maxDashPower;
            
            game.ai.vx += Math.cos(angle) * dashSpeed;
            game.ai.vy += Math.sin(angle) * dashSpeed;
        }
    } else {
        // В локальной игре обрабатываем только первого игрока
        if (e.code === 'Space' && game.player.dashCharging) {
            game.player.dashCharging = false;
            game.player.isDashing = true;
            // Конвертируем секунды в кадры (60 FPS)
            game.player.dashCooldown = params.dashCooldown * 60;
            
            // Расчет вектора рывка
            const angle = Math.atan2(game.mouse.y - game.player.y, game.mouse.x - game.player.x);
            const dashSpeed = game.player.dashPower * params.maxDashPower;
            
            game.player.vx += Math.cos(angle) * dashSpeed;
            game.player.vy += Math.sin(angle) * dashSpeed;
        }
    }
});