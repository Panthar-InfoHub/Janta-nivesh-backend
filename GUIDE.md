# Developer Guide — Velvet Backend (v2)

Welcome to the team. This document is **not** the README (that's a product/architecture overview — go read it too). This is the "how do I actually write code in this repo" guide. Read this once, fully, before you open a PR.

---

## 1. Why this v2 exists — the Cybrilla migration

Velvet v1 was built directly on top of **Finnsys** for auth, KYC, mutual fund catalog, and NSE order execution. That coupling is exactly what v2 exists to remove.

**The aim of this version is to migrate the Finnsys dependency to Cybrilla**, without rewriting the rest of the product. That's the single biggest reason the codebase is structured the way it is:

```
Controller → Service → (External Provider)
                 ↑
        this is the seam we swap
```

Because business logic lives in the **service layer** and never talks to a vendor SDK directly from a controller, swapping Finnsys → Cybrilla should ideally mean:

- Writing a new `*.cybrilla.service.ts` next to the existing `*.finnsys.service.ts` (see `src/services/finnsys/`, `src/services/kyc/kyc.finnsys.service.ts`, `src/services/user.finnsys.service.ts`).
- Keeping the **same function signatures / return shapes** the calling service or controller already expects.
- Flipping the import (or a provider switch behind an env flag) once Cybrilla is verified — **not** rewriting controllers, routes, or the DB schema.

**What this means for you as a junior dev working on this migration:**
- Never call a Finnsys (or Cybrilla) HTTP endpoint from a controller. It always goes controller → service → provider client.
- If you're porting a flow (e.g. KYC initiation, MF order placement, auth), first find the existing Finnsys service function, understand its **inputs/outputs**, and reproduce that same contract with Cybrilla. The rest of the app shouldn't need to know which provider is behind it.
- If Cybrilla's data shape genuinely differs (it will), normalize it inside the service layer before returning it — don't leak raw Cybrilla payloads up to the controller/response.
- Flag any place where Finnsys-specific assumptions have leaked into the controller or into Prisma models — that's tech debt worth calling out in your PR, not silently working around.

---

## 2. The architecture: Model → Controller → Service → Route

Every feature in this repo follows the same shape. There is no "fat controller" and no "business logic in routes." If you remember one diagram, remember this one:

```
Client Request
      │
      ▼
 routes/*.router.ts        defines the URL + HTTP method, wires middleware, points to a controller method
      │
      ▼
 middleware (jwt / session / kyc)   auth checks, attaches req.user, etc.
      │
      ▼
 controller/*.controller.ts  validates input (Zod), calls service, shapes the HTTP response
      │
      ▼
 services/*.service.ts       ALL business logic lives here: DB queries, Redis, external APIs
      │
      ▼
 prisma/models/*.prisma      the DB schema (source of truth for data shape)
      │
      ▼
 PostgreSQL / Redis / Finnsys / Cybrilla / Blostem
```

### 2.1 Routes (`src/routes/`)

Thin. A route file just wires an HTTP verb + path to a controller method (and any middleware). No logic, no validation, no try/catch.

```ts
// src/routes/bundle.router.ts
import { Router } from "express";
import { bundle_controller } from "../controller/bundle.controller.js";

export const bundle_router = Router();

bundle_router.get("/", bundle_controller.get_bundles);
bundle_router.get("/:id", bundle_controller.get_bundle_by_id);
bundle_router.post("/", bundle_controller.create_bundle);
bundle_router.delete("/:id", bundle_controller.delete_bundle);
```

Then it gets mounted once in `src/server.ts`:

```ts
app.use("/api/v1/bundles", bundle_router)
```

If you add a new module, create the router, then add exactly one `app.use(...)` line in `server.ts`. That's it.

### 2.2 Controllers (`src/controller/`)

A controller method's job, every time, in this order:
1. Log that the request came in.
2. Validate `req.body` / `req.params` / `req.query` with a **Zod schema**.
3. Call the service layer to do the actual work.
4. Send a consistent JSON response.
5. Catch anything that throws and pass it to `next(error)` — never swallow it.

Real example (`src/controller/bundle.controller.ts`):

```ts
class BundleControllerClass {

    create_bundle = async (req: Request, res: Response, next: NextFunction) => {
        try {
            logger.info("Creating a new bundle");
            const data = create_bundle_zod_schema.parse(req.body); // 2. validate

            const result = await bundle_service.create_bundle(data); // 3. delegate to service

            res.status(201).json({                                  // 4. consistent response
                success: true,
                message: "Bundle created successfully",
                data: result
            });
            return;
        } catch (error) {
            logger.error("Error in create_bundle controller:", error); // 5. log + forward
            next(error);
            return;
        }
    }
}

export const bundle_controller = new BundleControllerClass();
```

Controllers are exported as a **singleton instance of a class** (`export const bundle_controller = new BundleControllerClass()`), not a bag of loose functions. Follow this pattern for new controllers.

**A controller should never:**
- Contain a Prisma query directly.
- Call `axios`/an external API directly.
- Contain business rules (e.g. "SIP amount must be > minimum lumpsum" belongs in the service, not the controller).

### 2.3 Services (`src/services/`)

This is where the actual work happens: Prisma queries, Redis caching, calls to Finnsys/Cybrilla/Blostem, calculations, orchestration across multiple steps.

Services are also exported as singleton class instances, e.g. `export const bundle_service = new BundleServiceClass()`. Bigger domains split into sub-services in a subfolder — see `src/services/mutual-funds/` (`MfQueryService`, `MfCartService`, `MfOrderService`, `MfSipService`, `MfHelperService`) or `src/services/kyc/`. If your domain is growing past ~300 lines, split it the same way rather than making one giant file.

**Rule of thumb:** if it touches the database, Redis, or a third-party API, it belongs in a service — not a controller, not a helper file.

### 2.4 Models (`src/prisma/models/*.prisma`)

The schema is split by domain (`user.prisma`, `mutual-fund.prisma`, `fd.prisma`, `kyc.prisma`, `bundle.prisma`, `notification.prisma`, `sequence.prisma`) and stitched together by Prisma's multi-file schema support. If a feature needs a new table or column:

1. Edit/create the relevant file in `src/prisma/models/`.
2. Run the migration locally (`npx prisma migrate dev`).
3. Use the generated types (`src/prisma/generated/prisma/...`) everywhere — never hand-write a type that duplicates a Prisma model. Import input types like `MfProductWhereInput` from the generated client instead of redefining them.

---

## 3. Logging — `src/middleware/logger.ts`

We use `winston`. There's one shared logger instance — import it, don't create your own.

```ts
import logger from "../middleware/logger.js"; // path depends on where you are
```

Levels available (in order of severity): `error`, `warn`, `info`, `http`, `debug`. All levels are enabled (`level: 'debug'` in the config), so `logger.debug(...)` calls **will** show up — use them generously for tracing.

**When to use which level:**

| Level | Use for |
|---|---|
| `logger.error(...)` | Something failed — caught exceptions, failed external calls. Always pair with `next(error)` in controllers. |
| `logger.warn(...)` | Unexpected but recoverable state (e.g. falling back to a default, a stale cache hit). |
| `logger.info(...)` | High-level request lifecycle: "Creating a new bundle", "Fetching bundles - Page: X". One or two per request is normal. |
| `logger.debug(...)` | **Step-by-step tracing.** Intermediate values, what branch you took, what you're about to call. This is what you reach for while developing and debugging. |

**How we want `debug` used (per team convention):** log at each meaningful step of a request so anyone reading Cloud Logging can reconstruct exactly what happened without attaching a debugger. Be descriptive — include the identifiers you're working with, not just "here".

```ts
logger.debug("Resolving product code for redemption", { source, scheme_id, prod_code });
const product_code = await resolve_product_code(source, scheme_id, prod_code);

logger.debug("Constructing Finnsys redemption payload", { product_code, redem_type });
const payload = build_redemption_payload(...);

logger.debug("Submitting redemption to Finnsys NSE API", { order_ref_number });
const response = await finnsys_client.post("/nse/transaction", payload);

logger.debug("Finnsys redemption response received", { order_id: response.data.order_id });
```

You can pass an object as a second arg (it gets pretty-printed via `splat`) — prefer that over string-concatenating JSON:

```ts
logger.debug("Bundle result ==> ", bundle_result); // fine, matches existing style
```

**Don't:**
- Log secrets, full JWTs, raw PANs/Aadhaar numbers, or full phone numbers — mask/redact before logging.
- Don't use `console.log` anywhere. Always the shared `logger`.
- Log-and-continue on an error you should actually be throwing/forwarding.

---

## 4. Errors — `src/middleware/error.middleware.ts`

There is exactly one way to fail in this codebase: throw (or `next()`) an `AppError`, and let the global `errorHandler` turn it into a consistent HTTP response.

```ts
import AppError from "../middleware/error.middleware.js";

throw new AppError("Bundle not found", 404, "NotFoundError");
```

Signature: `new AppError(message, statusCode = 500, errorType = "ApplicationError", details?, isOperational = true)`.

### Why you almost never construct the response yourself

The `errorHandler` (mounted last in `server.ts` via `app.use(errorHandler)`) already knows how to translate common failure types into a well-formed `AppError` automatically:

- **Zod validation errors** (`schema.parse(...)` throwing) → `400` with a `details` array of `{ path, message, code }` per field. This is why controllers just call `.parse()` and let it throw — no manual validation branching needed.
- **Prisma errors** — unique constraint (`P2002`), foreign key (`P2003`), not found (`P2025`), transaction conflicts (`P2034`), connection failures, etc. — all mapped to sensible status codes and human messages.
- **JWT errors** (`JsonWebTokenError`, `TokenExpiredError`) → `401`.
- Anything unrecognized → generic `500 ServerError`, and non-operational errors don't leak internals to the client.

Every response — success or failure — has the same envelope:

```json
{ "success": true, "message": "...", "data": { ... } }
{ "success": false, "error": { "type": "NotFoundError", "message": "...", "details": [...] } }
```

### How you actually use this in a controller/service

```ts
// controller
try {
    logger.info("Fetching bundle by id");
    const data = create_bundle_zod_schema.parse(req.body); // throws ZodError -> auto handled
    const result = await bundle_service.get_bundle_by_id(req.params.id); // may throw AppError
    res.status(200).json({ success: true, message: "...", data: result });
} catch (error) {
    logger.error("Error in get_bundle_by_id controller:", error);
    next(error); // ALWAYS forward to the error middleware, never res.json an error yourself
}
```

```ts
// service — throw domain-specific errors with the right status code
const bundle = await db.bundle.findUnique({ where: { id } });
if (!bundle) {
    throw new AppError(`Bundle not found: ${id}`, 404, "NotFoundError");
}
```

**Rules:**
- Every controller method wraps its body in `try { ... } catch (error) { logger.error(...); next(error); }`. No exceptions to this.
- Never call `res.status(500).json(...)` manually in a controller — that's what `next(error)` + the middleware is for.
- Never swallow an error silently (empty catch block). If you truly need to ignore one, `logger.warn` it and explain why in a comment.

---

## 5. Redis — `src/lib/redis.ts`

Single shared client, connected once at boot (`export const redis = await RedisService.getInstance()`), imported wherever needed:

```ts
import { redis } from "../lib/redis.js";
```

Used for two things in this repo:

**1. Caching expensive reads** (MF catalog lookups, portfolio snapshots) — always with an explicit TTL:

```ts
const cached = await redis.get(mf_detail_key);
if (cached) {
    logger.debug("Cache hit for mf detail", { mf_detail_key });
    return JSON.parse(cached);
}

logger.debug("Cache miss, fetching from Finnsys", { mf_detail_key });
const result = await fetch_from_finnsys(...);
await redis.set(mf_detail_key, JSON.stringify(result), { EX: 60 * 60 }); // 1 hour TTL
```

**2. Short-lived state** — OTPs, unread-notification flags:

```ts
await redis.set(redis_key, otp, { EX: OTP_EXPIRY_SECONDS });
...
const stored_otp = await redis.get(redis_key);
await redis.del(redis_key); // consume once used
```

**Cache invalidation:** whenever the underlying data changes (e.g. a portfolio-mutating action like a purchase or redemption), explicitly `redis.del(...)` the relevant cache key right after the mutation succeeds. Grep `mf_portfolio:finnsys:` in `mutual-fund.controller.ts` for the pattern.

**Rules:**
- Always set an `EX` (TTL). Never cache without an expiry.
- Key naming: `domain:sub-domain:identifier`, e.g. `mf_portfolio:finnsys:${user.id}`.
- Cache reads/writes belong in the **service** layer (or controller for simple response-caching), never bypass the shared `redis` client with a new connection.

---

## 6. Zod — validation contract

**Every POST/PUT/PATCH request body must be validated with a Zod schema before it touches a service.** No exceptions, no manual `if (!req.body.x) throw ...` checks.

Schemas live in `src/lib/zod-schemas/*.schema.ts` (domain-specific: `bundle.schema.ts`, `finnsys.schema.ts`, `user.schema.ts`, `transaction.schema.ts`, etc.) or `src/schemas/` for auth/report. Put a new schema next to its domain's existing ones.

```ts
// src/lib/zod-schemas/bundle.schema.ts
export const create_bundle_zod_schema = z.object({
    bundle_name: z.string().min(1, "Bundle name is required"),
    equity_percentage: z.number().min(0).max(100).optional().default(0),
    categories: z.array(bundle_category_schema).min(1, "At least one category is required in a bundle"),
});

export type CreateBundleInput = z.infer<typeof create_bundle_zod_schema>;
```

Use `z.discriminatedUnion` for "either/or" payloads instead of hand-rolled branching — see `add_bundle_to_cart_schema` (SIP vs LUMPSUM) or the MF redemption rule ("send `redemption_amount` OR `redemption_units`, never both"). Use `.refine(...)` for cross-field business rules (e.g. allocations must sum to 100, SIP start date ≥30 days out).

In the controller, just call `.parse(req.body)` — a failed parse throws `ZodError`, which the error middleware auto-converts to a clean `400` response. Don't wrap it in your own try/catch logic beyond the standard controller try/catch.

```ts
const data = create_bundle_zod_schema.parse(req.body);
```

Export the inferred TS type (`z.infer<typeof schema>`) and use *that* as your service function's input type — this keeps validation and typing as a single source of truth instead of two.

---

## 7. Checklist — building a new feature/endpoint

1. **Schema first.** Need a new table/column? Add it to the right file in `src/prisma/models/`, run `npx prisma migrate dev`.
2. **Zod schema.** For any POST/PUT/PATCH, write the input schema in `src/lib/zod-schemas/<domain>.schema.ts`. Export the inferred type.
3. **Service.** Write/extend `src/services/<domain>.service.ts` (or a subfolder if the domain is large). All DB/Redis/external-API calls go here. `logger.debug` at each meaningful step.
4. **Controller.** Write/extend `src/controller/<domain>.controller.ts`. `try/catch`, `logger.info` on entry, `.parse()` the input, delegate to the service, respond with the `{ success, message, data }` envelope, `next(error)` on catch.
5. **Route.** Wire the method in `src/routes/<domain>.router.ts`, attach any middleware (`jwt`, `session`, `kyc`) it needs.
6. **Register.** If it's a new router file, add one `app.use("/api/v1/<domain>", <domain>_router)` line in `src/server.ts`.
7. **If it touches Finnsys/Cybrilla:** keep the provider-specific code inside the service layer only. Match the existing service's function contract if you're porting an existing Finnsys flow to Cybrilla.
8. Test locally against `http://localhost:8080`, then open your PR.

---

## 8. Quick do's and don'ts

**Do:**
- Use Prisma-generated types everywhere (`MfProductWhereInput`, etc.) instead of redefining shapes.
- Log descriptively at `debug` level through every non-trivial step of a request.
- Throw `AppError` with the right HTTP status and an `errorType` string that a frontend dev could reasonably switch on.
- Keep controllers thin, services fat.
- Give Redis keys a TTL and a clear `domain:sub:id` naming pattern.

**Don't:**
- Call Finnsys/Cybrilla/Blostem/Prisma/Redis directly from a controller.
- Use `console.log`.
- Use `any` where a real type is available.
- Manually construct error JSON responses in a controller — always `next(error)`.
- Cache without an expiry, or forget to invalidate a cache after a mutation.
- Leak raw third-party (Finnsys/Cybrilla) response shapes straight through to the API response — normalize in the service.

---

## 9. Where to go next

- [`README.md`](./README.md) — product overview, module breakdown (Auth/KYC/MF/FD/FIRE report), deployment, env vars.
- `src/services/finnsys/` and `src/services/*.finnsys.service.ts` — the current Finnsys integrations you'll be porting to Cybrilla.
- `src/lib/zod-schemas/finnsys.schema.ts` — existing Finnsys payload contracts, useful as a reference for what Cybrilla needs to match or replace.

If something in this guide is out of date or you find a pattern in the code that contradicts it, fix the code (or ping the team) — this document should always describe how we actually work, not how we wish we did.
