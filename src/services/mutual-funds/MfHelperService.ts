import AppError from "../../middleware/error.middleware.js";

export class MfHelperService {
    
    public map_frequency_code_to_type(freq_code: string): string {
        const frequency_map: { [key: string]: string } = {
            'DZ': 'DAILY',
            'D': 'DAILY',
            'WD': 'WEEKLY',
            'OW': 'FORTNIGHTLY',
            'OM': 'MONTHLY',
            'Q': 'QUARTERLY',
            'H': 'SEMI-ANNUAL',
            'Y': 'ANNUAL'
        };

        const mapped_type = frequency_map[freq_code];
        if (!mapped_type) {
            throw new AppError(`Invalid frequency code: ${freq_code}`, 400, "INVALID_FREQUENCY_CODE");
        }
        return mapped_type;
    }

    public get_primary_bank_details(user: any) {
        if (!user.user_bank_details || user.user_bank_details.length === 0) {
            throw new AppError("No bank details found for user", 400, "BANK_DETAILS_MISSING");
        }

        const primary_bank = user.user_bank_details.find((b: any) => b.is_primary) || user.user_bank_details[0];
        return primary_bank;
    }

    public extract_date_range_from_sip_items(sip_items: any[]): { start_date: string; end_date: string } {
        if (!sip_items || sip_items.length === 0) {
            throw new AppError("No SIP items found", 400, "NO_SIP_ITEMS");
        }

        const parse_date = (date_str: string): { comparable: string; formatted: string } => {
            if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(date_str)) {
                const months: { [key: string]: string } = {
                    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
                    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
                };
                const [day, mon, year] = date_str.split('-');
                const month = months[mon];
                if (!month) throw new AppError(`Invalid month in date: ${date_str}`, 400, "INVALID_DATE_FORMAT");
                const comparable = `${year}-${month}-${day}`;
                const formatted = `${day}/${month}/${year}`;
                return { comparable, formatted };
            }
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(date_str)) {
                const [day, month, year] = date_str.split('/');
                const comparable = `${year}-${month}-${day}`;
                const formatted = date_str;
                return { comparable, formatted };
            }
            if (/^\d{4}-\d{2}-\d{2}$/.test(date_str)) {
                const [year, month, day] = date_str.split('-');
                const comparable = date_str;
                const formatted = `${day}/${month}/${year}`;
                return { comparable, formatted };
            }
            throw new AppError(`Invalid date format: ${date_str}. Expected DD-MMM-YYYY, DD/MM/YYYY, or YYYY-MM-DD`, 400, "INVALID_DATE_FORMAT");
        };

        const all_dates = sip_items.map((item: any) => ({
            start: parse_date(item.sip_st_date),
            end: parse_date(item.sip_en_date)
        }));

        const min_start = all_dates.reduce((min, curr) =>
            curr.start.comparable < min.start.comparable ? curr : min
        ).start;

        const max_end = all_dates.reduce((max, curr) =>
            curr.end.comparable > max.end.comparable ? curr : max
        ).end;

        return {
            start_date: min_start.formatted,
            end_date: max_end.formatted
        };
    }

    public calculate_total_sip_amount(sip_items: any[]): string {
        if (!sip_items || sip_items.length === 0) {
            throw new AppError("No SIP items found", 400, "NO_SIP_ITEMS");
        }

        const total = sip_items.reduce((sum: number, item: any) => {
            const amount = parseFloat(item.sip_amt || item.txn_amount || "0");
            if (isNaN(amount)) {
                throw new AppError(`Invalid amount in cart item: ${item.sip_amt || item.txn_amount}`, 400, "INVALID_AMOUNT");
            }
            return sum + amount;
        }, 0);

        return total.toString();
    }

    public calculate_installments_count(sip_items: any[], start_date: string, end_date: string): { [key: number]: number } {
        if (!sip_items || sip_items.length === 0) {
            throw new AppError("No SIP items found", 400, "NO_SIP_ITEMS");
        }

        const parse_date = (date_str: string): Date => {
            if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(date_str)) {
                const months: { [key: string]: number } = {
                    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
                };
                const [day, mon, year] = date_str.split('-');
                const month = months[mon];
                if (month === undefined) throw new AppError(`Invalid month: ${mon}`, 400, "INVALID_DATE_FORMAT");
                return new Date(parseInt(year), month, parseInt(day));
            }
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(date_str)) {
                const [day, month, year] = date_str.split('/');
                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            }
            if (/^\d{4}-\d{2}-\d{2}$/.test(date_str)) {
                const [year, month, day] = date_str.split('-');
                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            }
            throw new AppError(`Invalid date format: ${date_str}`, 400, "INVALID_DATE_FORMAT");
        };

        const start = parse_date(start_date);
        const end = parse_date(end_date);
        const days_diff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

        if (days_diff < 0) {
            throw new AppError("End date cannot be before start date", 400, "INVALID_DATE_RANGE");
        }

        const result: { [key: number]: number } = {};

        sip_items.forEach((item: any, index: number) => {
            const freq = item.sip_freq;
            let installments = 1;

            switch (freq) {
                case "DZ": 
                case "D": 
                    installments = days_diff;
                    break;
                case "WD": 
                    installments = Math.ceil(days_diff / 7);
                    break;
                case "OW": 
                    installments = Math.ceil(days_diff / 14);
                    break;
                case "OM": 
                    {
                        const total_months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
                        installments = total_months;
                    }
                    break;
                case "Q": 
                    {
                        const total_months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
                        installments = Math.floor(total_months / 3) + (total_months % 3 > 0 ? 1 : 0);
                    }
                    break;
                case "H": 
                    {
                        const total_months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
                        installments = Math.floor(total_months / 6) + (total_months % 6 > 0 ? 1 : 0);
                    }
                    break;
                case "Y": 
                    {
                        const total_months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
                        installments = Math.floor(total_months / 12) + (total_months % 12 > 0 ? 1 : 0);
                    }
                    break;
                default:
                    throw new AppError(`Invalid SIP frequency: ${freq}`, 400, "INVALID_FREQUENCY");
            }

            result[index] = Math.max(1, installments);
        });

        return result;
    }

    public parseDate(dateStr: string): Date | null {
        try {
            if (!dateStr || dateStr.trim() === "" || dateStr === "-") return null;

            if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(dateStr)) {
                const months: { [key: string]: number } = {
                    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
                };
                const [day, mon, year] = dateStr.split('-');
                const month = months[mon];
                if (month === undefined) return null;
                return new Date(parseInt(year), month, parseInt(day));
            }

            if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
                const [day, month, year] = dateStr.split('/');
                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            }

            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                const [year, month, day] = dateStr.split('-');
                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            }

            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) return d;

            return null;
        } catch (error) {
            return null;
        }
    }
}
