//! Tauri command surface for HTTP. The TS shim in `src/services/http.ts`
//! calls `invoke('xyzen_http_request', req)` and reshapes the reply into the
//! existing `HttpClient` contract.

use tauri::{AppHandle, Emitter, State};

use crate::events::XYZEN_AUTH_FAILED;
use crate::net::http::{HttpError, HttpRequest, HttpResponse};
use crate::state::AppState;

#[tauri::command]
pub async fn xyzen_http_request(
    app: AppHandle,
    state: State<'_, AppState>,
    req: HttpRequest,
) -> Result<HttpResponse, String> {
    match state.http.request(req).await {
        Ok(resp) => Ok(resp),
        Err(HttpError::AuthFailed) => {
            // Emit once per 401-after-retry so the webview can surface UI
            // state (e.g. the SettingsDialog's connection banner).
            let _ = app.emit(XYZEN_AUTH_FAILED, ());
            Err(HttpError::AuthFailed.to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}
