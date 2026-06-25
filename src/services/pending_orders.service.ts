import { mutual_fund_finnsys_service } from "./finnsys/mf.finnsys.service.js";
import { env } from "../lib/config-env.js";
import logger from "../middleware/logger.js";
import { wrapper_service } from "./wrapper.service.js";

class PendingOrdersServiceClass {
    /**
     * Parse date string like "10 JUL 2026" or "13/05/2026" into a Date object
     */
    private parseDate(dateStr: string): Date | null {
        try {
            if (!dateStr || dateStr.trim() === "" || dateStr === "-") return null;

            // Handle "13/05/2026" format
            if (dateStr.includes("/")) {
                const [day, month, year] = dateStr.split("/");
                return new Date(`${year}-${month}-${day}`);
            }

            // Handle "10 JUL 2026" format
            return new Date(dateStr);
        } catch (error) {
            return null;
        }
    }

    /**
     * Get start and end date for the last N days (YYYY-MM-DD format)
     */
    private getDateRange(days: number = 30) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);

        const formatDate = (d: Date) => d.toISOString().split("T")[0];

        return {
            from_date: formatDate(startDate),
            to_date: formatDate(endDate),
        };
    }

    /**
     * Fetch and merge pending lumpsum and SIP orders
     */
    async get_pending_orders(user_log: string, user_pwd: string, nse_client_code: string) {
        // Prepare payloads
        const lumpsum_date_range = this.getDateRange(6); // last 7 days, can be adjusted as needed

        const lumpsumPayload = {
            arn: env.ARN,
            username: user_log,
            password: user_pwd,
            type: "P", // PROVISIONAL
            data: {
                from_date: lumpsum_date_range.from_date,
                to_date: lumpsum_date_range.to_date,
                trans_type: "ALL",
                order_type: "ALL",
                sub_order_type: "ALL"
            }
        };

        logger.debug("Lumpsum payload for pending orders", lumpsumPayload);

        const sipPayload = {
            arn: env.ARN,
            username: user_log,
            password: user_pwd,
            data: {
                client_code: nse_client_code
            }
        };
        logger.debug("SIP payload for pending orders", sipPayload);

        try {
            // Fetch both in parallel
            const [lumpsumResponse, sipResponse] = await Promise.allSettled([
                mutual_fund_finnsys_service.get_order_status_report(lumpsumPayload),
                mutual_fund_finnsys_service.get_xsip_registration_report(sipPayload)
            ]);

            const pendingOrders: any[] = [];
            const currentDate = new Date();

            // 1. Process Lumpsum Orders (PROVISIONAL)
            if (lumpsumResponse.status === "fulfilled" && lumpsumResponse.value?.code === 1) {
                const lumpsumData = lumpsumResponse.value.data?.report_data || [];

                lumpsumData.forEach((order: any) => {
                    if (order.order_status === "VALID" && order.order_remark === "PROVISIONAL ORDER" && order.client_code === nse_client_code) {
                        pendingOrders.push({
                            id: order.order_id,
                            type: "LUMPSUM",
                            scheme_name: order.scheme_name,
                            amount: Number(order.amount) || 0,
                            date: order.request_date,
                            status: "PROVISIONAL",
                            status_remark: "Awaiting Settlement",
                            amc: order.amc_name || order.scheme_code,
                            frequency: null,
                            raw_data: order // optional, for debugging
                        });
                    }
                });
            } else if (lumpsumResponse.status === "rejected") {
                logger.error("Failed to fetch lumpsum orders for pending list", lumpsumResponse.reason);
            }

            // 2. Process SIP Orders (AUTHPENDING or ACTIVE with future date)
            if (sipResponse.status === "fulfilled" && sipResponse.value?.code === 1) {
                const sipData = sipResponse.value.data?.report_data || [];

                sipData.forEach((sip: any) => {
                    if (sip.client_code !== nse_client_code) return; // double check

                    let isPending = false;
                    let remark = "";

                    if (sip.status === "AUTHPENDING") {
                        isPending = true;
                        remark = "Awaiting Mandate Authorization";
                    } else if (sip.status === "ACTIVE") {
                        const startDate = this.parseDate(sip.start_date);
                        if (startDate && startDate > currentDate) {
                            isPending = true;
                            remark = "Awaiting First Installment";
                        }
                    }

                    if (isPending) {
                        pendingOrders.push({
                            id: sip.xsip_registration_no,
                            type: "SIP",
                            scheme_name: sip.scheme_name,
                            amount: Number(sip.installments_amount) || 0,
                            date: sip.xsip_registration_date,
                            status: sip.status,
                            status_remark: remark,
                            amc: sip.amc_name,
                            frequency: sip.frequency_type || "MONTHLY",
                            start_date: sip.start_date,
                            raw_data: sip // optional
                        });
                    }
                });
            } else if (sipResponse.status === "rejected") {
                logger.error("Failed to fetch SIP orders for pending list", sipResponse.reason);
            }

            // Sort by date (assuming we want newest first, but dates are strings. Let's parse and sort)
            pendingOrders.sort((a, b) => {
                const dateA = this.parseDate(a.date) || new Date(0);
                const dateB = this.parseDate(b.date) || new Date(0);
                return dateB.getTime() - dateA.getTime();
            });

            // Map logos and AMCs to the pending orders
            const amcSet = new Set<string>();
            const nseCodeSet = new Set<string>();

            pendingOrders.forEach(order => {
                if (order.type === "SIP" && order.amc) {
                    amcSet.add(order.amc);
                } else if (order.type === "LUMPSUM" && order.amc) {
                    // For lumpsum, order.amc currently holds the scheme_code (NSE code)
                    nseCodeSet.add(order.amc);
                }
            });

            // Fetch AMC names & logos for Lumpsum orders via NSE codes
            const nseCodes = Array.from(nseCodeSet);
            const nseDetailsMap = await wrapper_service.get_details_by_nse_codes(nseCodes);

            // Fetch logos for SIP orders via AMC names
            const amcNames = Array.from(amcSet);
            const logoMap = await wrapper_service.get_logos_of_amc(amcNames);

            pendingOrders.forEach(order => {
                if (order.type === "LUMPSUM") {
                    const details = nseDetailsMap.get(order.amc);
                    // Replace the NSE code with the actual AMC name
                    order.amc = details?.amc_name || order.amc; 
                    order.img_url = details?.img_url || "";
                } else {
                    order.img_url = logoMap.get(order.amc) || "";
                }
            });

            return {
                total_count: pendingOrders.length,
                pending_orders: pendingOrders
            };

        } catch (error) {
            logger.error("Error aggregating pending orders", error);
            throw error; // Let controller handle error response
        }
    }
}

export const pending_orders_service = new PendingOrdersServiceClass();