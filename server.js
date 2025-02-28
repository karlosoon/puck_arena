// Импорт необходимых модулей
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Настройка сервера Express
const app = express();
const server = http.createServer(app);

// Настройка WebSocket сервера
const wss = new WebSocket.Server({ server });

// Раздача статических файлов из директории public
app.use(express.static(path.join(__dirname, 'public')));

// Отображаем главную страницу для любых путей
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Хранение активных игр
const games = new Map();

// Обработка WebSocket соединений
wss.on('connection', (ws) => {
    console.log('Новое подключение');
    
    ws.isAlive = true;
    
    // Пинг для поддержания соединения
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    
    // Обработка сообщений от клиента
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'create_game':
                    handleCreateGame(ws);
                    break;
                
                case 'join_game':
                    handleJoinGame(ws, data.gameId);
                    break;
                
                case 'start_game':
                    handleStartGame(data.gameId);
                    break;
                
                case 'player_state':
                    handlePlayerState(ws, data);
                    break;
                
                case 'update_params':
                    handleUpdateParams(ws, data);
                    break;
                
                case 'round_end':
                    handleRoundEnd(data);
                    break;
            }
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    });
    
    // Обработка отключения клиента
    ws.on('close', () => {
        console.log('Соединение закрыто');
        handleDisconnect(ws);
    });
});

// Функция создания новой игры
function handleCreateGame(ws) {
    // Генерируем уникальный ID для игры
    const gameId = generateGameId();
    
    // Создаем новую игру с хостом
    games.set(gameId, {
        host: ws,
        player2: null,
        gameId: gameId
    });
    
    // Сохраняем ID игры в объекте соединения для быстрого доступа
    ws.gameId = gameId;
    ws.isHost = true;
    
    // Отправляем подтверждение создания игры
    ws.send(JSON.stringify({
        type: 'game_created',
        gameId: gameId
    }));
    
    console.log(`Создана новая игра с ID: ${gameId}`);
}

// Функция присоединения к существующей игре
function handleJoinGame(ws, gameId) {
    const game = games.get(gameId);
    
    if (!game) {
        ws.send(JSON.stringify({
            type: 'game_not_found'
        }));
        return;
    }
    
    if (game.player2) {
        ws.send(JSON.stringify({
            type: 'game_full'
        }));
        return;
    }
    
    // Добавляем второго игрока
    game.player2 = ws;
    ws.gameId = gameId;
    ws.isPlayer2 = true;
    
    // Сообщаем игроку, что он присоединился
    ws.send(JSON.stringify({
        type: 'game_joined',
        gameId: gameId
    }));
    
    // Сообщаем хосту, что второй игрок присоединился
    game.host.send(JSON.stringify({
        type: 'player_joined'
    }));
    
    console.log(`Игрок присоединился к игре ${gameId}`);
}

// Функция начала игры
function handleStartGame(gameId) {
    const game = games.get(gameId);
    
    if (!game || !game.player2) {
        return;
    }
    
    // Отправляем сигнал начала игры второму игроку
    game.player2.send(JSON.stringify({
        type: 'start_game'
    }));
    
    console.log(`Игра ${gameId} началась`);
}

// Функция обновления состояния игрока
function handlePlayerState(ws, data) {
    const game = games.get(data.gameId);
    
    if (!game) {
        return;
    }
    
    // Определяем, кому отправить обновление (хосту или второму игроку)
    const recipient = ws.isHost ? game.player2 : game.host;
    
    if (recipient && recipient.readyState === WebSocket.OPEN) {
        recipient.send(JSON.stringify({
            type: 'game_state',
            player: data.player
        }));
    }
}

// Функция обновления параметров игры
function handleUpdateParams(ws, data) {
    const game = games.get(ws.gameId);
    
    if (!game || !ws.isHost) {
        return;
    }
    
    // Отправляем обновленные параметры второму игроку
    if (game.player2 && game.player2.readyState === WebSocket.OPEN) {
        game.player2.send(JSON.stringify({
            type: 'update_params',
            params: data.params
        }));
    }
}

// Функция завершения раунда
function handleRoundEnd(data) {
    const game = games.get(data.gameId);
    
    if (!game) {
        return;
    }
    
    // Отправляем результат обоим игрокам
    const message = JSON.stringify({
        type: 'round_result',
        blueScore: data.blueScore,
        redScore: data.redScore,
        message: data.message,
        nextRound: data.nextRound,
        gameOver: data.gameOver
    });
    
    if (game.host && game.host.readyState === WebSocket.OPEN) {
        game.host.send(message);
    }
    
    if (game.player2 && game.player2.readyState === WebSocket.OPEN) {
        game.player2.send(message);
    }
}

// Функция обработки отключения игрока
function handleDisconnect(ws) {
    if (!ws.gameId) {
        return;
    }
    
    const game = games.get(ws.gameId);
    
    if (!game) {
        return;
    }
    
    // Уведомляем оппонента об отключении
    if (ws.isHost && game.player2) {
        if (game.player2.readyState === WebSocket.OPEN) {
            game.player2.send(JSON.stringify({
                type: 'opponent_disconnected'
            }));
        }
    } else if (ws.isPlayer2 && game.host) {
        if (game.host.readyState === WebSocket.OPEN) {
            game.host.send(JSON.stringify({
                type: 'opponent_disconnected'
            }));
        }
    }
    
    // Удаляем игру
    games.delete(ws.gameId);
    console.log(`Игра ${ws.gameId} завершена из-за отключения игрока`);
}

// Генерация простого ID для игры
function generateGameId() {
    // Возвращаем 6 символов в верхнем регистре
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Проверка соединений на активность
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('Соединение не отвечает, закрываем');
            return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// Очистка интервала при завершении сервера
wss.on('close', () => {
    clearInterval(interval);
});

// Определение порта и запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Откройте http://localhost:${PORT} в браузере`);
});