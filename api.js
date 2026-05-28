window.BingoApi = {
    async request(path, options = {}) {
        const response = await fetch(path, {
            headers: { "Content-Type": "application/json", ...(options.headers || {}) },
            ...options,
            body: options.body ? JSON.stringify(options.body) : undefined
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || "Request failed.");
        }

        return data;
    },

    createRoom(sessionId) {
        return this.request("/api/rooms", {
            method: "POST",
            body: { sessionId }
        });
    },

    getRoom(code) {
        return this.request(`/api/rooms/${encodeURIComponent(code)}`);
    },

    joinRoom(code, name, sessionId) {
        return this.request(`/api/rooms/${encodeURIComponent(code)}/join`, {
            method: "POST",
            body: { name, sessionId }
        });
    },

    startRoom(code, sessionId) {
        return this.request(`/api/rooms/${encodeURIComponent(code)}/start`, {
            method: "POST",
            body: { sessionId }
        });
    },

    stopRoom(code, sessionId) {
        return this.request(`/api/rooms/${encodeURIComponent(code)}/stop`, {
            method: "POST",
            body: { sessionId }
        });
    },

    callNumber(code, sessionId) {
        return this.request(`/api/rooms/${encodeURIComponent(code)}/call-number`, {
            method: "POST",
            body: { sessionId }
        });
    },

    resetRoom(code, sessionId) {
        return this.request(`/api/rooms/${encodeURIComponent(code)}/reset`, {
            method: "POST",
            body: { sessionId }
        });
    },

    transferHost(code, sessionId, newHostPlayerId) {
        return this.request(`/api/rooms/${encodeURIComponent(code)}/transfer-host`, {
            method: "POST",
            body: { sessionId, newHostPlayerId }
        });
    },

    resetBoard(boardId, sessionId) {
        return this.request(`/api/boards/${encodeURIComponent(boardId)}/reset`, {
            method: "POST",
            body: { sessionId }
        });
    },

    markBoard(boardId, sessionId, markedNumbers) {
        return this.request(`/api/boards/${encodeURIComponent(boardId)}/mark`, {
            method: "POST",
            body: { sessionId, markedNumbers }
        });
    },

    claimBingo(boardId, sessionId) {
        return this.request(`/api/boards/${encodeURIComponent(boardId)}/bingo`, {
            method: "POST",
            body: { sessionId }
        });
    }
};
