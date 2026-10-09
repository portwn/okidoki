// Thin fetch wrapper for the API: unified error handling and path encoding.

export class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

// Builds a URL from segments, encoding each one separately (document paths are
// several segments joined by "/"; encodeURIComponent would break the slashes).
export function apiPath(...segments) {
    return segments
        .filter((s) => s !== undefined && s !== null && s !== '')
        .map((s) => String(s).split('/').map(encodeURIComponent).join('/'))
        .join('/');
}

// Throws ApiError on non-2xx, returns Response (for cases that need the status).
export async function apiFetch(url, options = {}, signal) {
    const response = await fetch(url, { ...options, signal });
    if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
            const text = (await response.text()).trim();
            if (text) message = text;
        } catch (e) {
            // Body unavailable — keep the status.
        }
        throw new ApiError(message, response.status);
    }
    return response;
}

// Returns parsed JSON (or null for 204/empty response).
export async function fetchJSON(url, options = {}, signal) {
    const response = await apiFetch(url, options, signal);
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new ApiError('Invalid JSON response', response.status);
    }
}

export function jsonBody(body) {
    return {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    };
}
