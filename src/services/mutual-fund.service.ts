import { MfQueryService } from "./mutual-funds/MfQueryService.js";
import { MfCartService } from "./mutual-funds/MfCartService.js";
import { MfOrderService } from "./mutual-funds/MfOrderService.js";
import { MfSipService } from "./mutual-funds/MfSipService.js";
import { MfHelperService } from "./mutual-funds/MfHelperService.js";

export type { pagination } from "./mutual-funds/MfQueryService.js";

class MutualFundFacadeService {
    // 1. Initialize shared helpers and standalone services
    public readonly helper = new MfHelperService();
    public readonly query = new MfQueryService();

    // 2. Initialize services that require dependencies
    public readonly cart = new MfCartService(this.query);
    public readonly order = new MfOrderService(this.helper, this.query);
    public readonly sip = new MfSipService(this.helper);
}

// Export the single instance (Singleton) to be used by controllers
export const mutual_funds_service = new MutualFundFacadeService();