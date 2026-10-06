const API_BASE =
  process.env.EQUITYAI_API_URL ||
  "https://api.equityai.com.ng";

const SUPABASE_URL =
  "https://lgsjppqekxmwobyxyhnm.supabase.co";

const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxnc2pwcHFla3htd29ieXh5aG5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NjkyNzMsImV4cCI6MjA5NDE0NTI3M30.3b0wregkvDC39_Vjro1veA1V_3dOvQWB4CSsTae7JxY";

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

async function parseBackendResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      detail: text,
    };
  }
}

function getBearerToken(event) {
  const authorization =
    event.headers.authorization ||
    event.headers.Authorization ||
    "";

  const match = authorization.match(
    /^Bearer\s+(.+)$/i
  );

  return match ? match[1].trim() : "";
}

async function authorizeAdmin(event) {
  const token = getBearerToken(event);

  if (!token) {
    return {
      ok: false,
      statusCode: 401,
      detail: "Authentication required.",
    };
  }

  /*
   * Ask Supabase Auth to validate the JWT.
   * The browser-provided token is never trusted directly.
   */
  const userResponse = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    }
  );

  if (!userResponse.ok) {
    return {
      ok: false,
      statusCode: 401,
      detail: "Invalid or expired authentication session.",
    };
  }

  const user = await userResponse.json();

  if (!user || !user.id) {
    return {
      ok: false,
      statusCode: 401,
      detail: "Authenticated user could not be identified.",
    };
  }

  /*
   * Query only the authenticated user's profile.
   * Supabase remains the source of truth for admin status.
   */
  const profileUrl =
    `${SUPABASE_URL}/rest/v1/profiles` +
    `?id=eq.${encodeURIComponent(user.id)}` +
    `&select=id,is_admin`;

  const profileResponse = await fetch(
    profileUrl,
    {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    }
  );

  if (!profileResponse.ok) {
    return {
      ok: false,
      statusCode: 403,
      detail: "Unable to verify administrator access.",
    };
  }

  const profiles = await profileResponse.json();
  const profile =
    Array.isArray(profiles) && profiles.length
      ? profiles[0]
      : null;

  if (!profile || profile.is_admin !== true) {
    return {
      ok: false,
      statusCode: 403,
      detail: "Administrator access required.",
    };
  }

  return {
    ok: true,
    userId: user.id,
  };
}

exports.handler = async function (event) {
  const apiKey = process.env.EQUITYAI_API_KEY;

  if (!apiKey) {
    return jsonResponse(500, {
      detail:
        "EquityAI API authentication is not configured.",
    });
  }

  try {
    /*
     * Every RAG management operation requires a
     * genuine Supabase-authenticated administrator.
     */
    const authorization =
      await authorizeAdmin(event);

    if (!authorization.ok) {
      return jsonResponse(
        authorization.statusCode,
        {
          detail: authorization.detail,
        }
      );
    }

    /*
     * ------------------------------------------------------
     * GET — list RAG documents
     * ------------------------------------------------------
     */
    if (event.httpMethod === "GET") {
      const response = await fetch(
        `${API_BASE}/documents`,
        {
          method: "GET",
          headers: {
            "X-API-Key": apiKey,
            Accept: "application/json",
          },
        }
      );

      const body =
        await parseBackendResponse(response);

      return jsonResponse(
        response.status,
        body
      );
    }

      /*
       * ------------------------------------------------------
       * POST — direct-to-S3 document intake control plane
       * ------------------------------------------------------
       */
      if (event.httpMethod === "POST") {
        const contentType =
          event.headers["content-type"] ||
          event.headers["Content-Type"] ||
          "";

        if (!contentType.toLowerCase().startsWith("application/json")) {
          return jsonResponse(400, {
            detail: "RAG document control requests require application/json.",
          });
        }

        let payload = {};

        try {
          payload = JSON.parse(event.body || "{}");
        } catch {
          return jsonResponse(400, {
            detail: "Invalid JSON request.",
          });
        }

        const action =
          typeof payload.action === "string"
            ? payload.action.trim()
            : "";

        if (action === "upload_url") {
          const filename =
            typeof payload.filename === "string"
              ? payload.filename.trim()
              : "";

          if (!filename) {
            return jsonResponse(400, {
              detail: "PDF filename is required.",
            });
          }

          const response = await fetch(
            `${API_BASE}/documents/upload-url`,
            {
              method: "POST",
              headers: {
                "X-API-Key": apiKey,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({ filename }),
            }
          );

          const body =
            await parseBackendResponse(response);

          return jsonResponse(response.status, body);
        }

        if (action === "upload_confirm") {
          const uploadId =
            typeof payload.upload_id === "string"
              ? payload.upload_id.trim()
              : "";

          const filename =
            typeof payload.filename === "string"
              ? payload.filename.trim()
              : "";

          if (!uploadId || !filename) {
            return jsonResponse(400, {
              detail: "Upload ID and PDF filename are required.",
            });
          }

          const confirmation = {
            upload_id: uploadId,
            filename,
          };

          [
            "company_name",
            "ticker",
            "exchange",
            "market",
            "country",
            "currency",
            "report_type",
            "fiscal_year",
            "fiscal_quarter",
            "fiscal_half",
            "period_start",
            "period_end",
            "publication_date",
            "reporting_period",
          ].forEach(function (key) {
            if (
              payload[key] !== undefined &&
              payload[key] !== null &&
              String(payload[key]).trim() !== ""
            ) {
              confirmation[key] =
                String(payload[key]).trim();
            }
          });

          const response = await fetch(
            `${API_BASE}/documents/upload-confirm`,
            {
              method: "POST",
              headers: {
                "X-API-Key": apiKey,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify(confirmation),
            }
          );

          const body =
            await parseBackendResponse(response);

          return jsonResponse(response.status, body);
        }

        return jsonResponse(400, {
          detail: "Unsupported RAG document upload action.",
        });
      }


    /*
     * ------------------------------------------------------
     * DELETE — delete RAG document
     * ------------------------------------------------------
     */
    if (event.httpMethod === "DELETE") {
      let payload = {};

      try {
        payload = JSON.parse(
          event.body || "{}"
        );
      } catch {
        return jsonResponse(400, {
          detail: "Invalid JSON request.",
        });
      }

      const documentName =
        typeof payload.document === "string"
          ? payload.document.trim()
          : "";

      if (!documentName) {
        return jsonResponse(400, {
          detail: "Document name is required.",
        });
      }

      const response = await fetch(
        `${API_BASE}/documents/${encodeURIComponent(
          documentName
        )}`,
        {
          method: "DELETE",
          headers: {
            "X-API-Key": apiKey,
            Accept: "application/json",
          },
        }
      );

      const body =
        await parseBackendResponse(response);

      return jsonResponse(
        response.status,
        body
      );
    }

    return {
      statusCode: 405,
      headers: {
        Allow: "GET, POST, DELETE",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        detail: "Method not allowed.",
      }),
    };
  } catch (error) {
    console.error(
      "RAG document gateway error:",
      error
    );

    return jsonResponse(502, {
      detail:
        "Unable to communicate with the EquityAI RAG service.",
    });
  }
};
