// outstanding_amount

import { PrismaClient } from "../prisma/generated/prisma/client.js";
import { Prisma } from "../prisma/generated/prisma/client.js";
import { encrypt, decrypt, generateBlindIndex } from "./encryption.js";

// Helper to decrypt decimal strings back to Prisma.Decimal
function decryptDecimal(value: string | null | undefined): Prisma.Decimal | null {
    const decrypted = decrypt(value);
    return decrypted ? new Prisma.Decimal(decrypted) : null;
}

// Helper to decrypt float strings back to numbers
function decryptFloat(value: string | null | undefined): number | null {
    const decrypted = decrypt(value);
    return decrypted ? parseFloat(decrypted) : null;
}

export function extendPrismaClient(client: PrismaClient) {
    return client.$extends({
        result: {
            user: {
                email: {
                    needs: { email: true },
                    compute(user) {
                        return decrypt(user.email);
                    }
                },
                phone_no: {
                    needs: { phone_no: true },
                    compute(user) {
                        return decrypt(user.phone_no);
                    }
                },
                full_name: {
                    needs: { full_name: true },
                    compute(user) {
                        return decrypt(user.full_name);
                    }
                },
                dob: {
                    needs: { dob: true },
                    compute(user) {
                        const val = decrypt(user.dob);
                        return val ? new Date(val) : null;
                    }
                }
            },
            userNetWorthSnapshot: {
                netWorth: {
                    needs: { netWorth: true },
                    compute(snapshot) {
                        return decryptFloat(snapshot.netWorth) ?? 0;
                    }
                },
                assets: {
                    needs: { assets: true },
                    compute(snapshot) {
                        return decryptFloat(snapshot.assets) ?? 0;
                    }
                },
                liabilities: {
                    needs: { liabilities: true },
                    compute(snapshot) {
                        return decryptFloat(snapshot.liabilities) ?? 0;
                    }
                }
            },
            userFinance: {
                annual_income: {
                    needs: { annual_income: true },
                    compute(f) { return decryptDecimal(f.annual_income) ?? new Prisma.Decimal(0); }
                },
                expense_house: {
                    needs: { expense_house: true },
                    compute(f) { return decryptDecimal(f.expense_house) ?? new Prisma.Decimal(0); }
                },
                expense_food: {
                    needs: { expense_food: true },
                    compute(f) { return decryptDecimal(f.expense_food) ?? new Prisma.Decimal(0); }
                },
                expense_transportation: {
                    needs: { expense_transportation: true },
                    compute(f) { return decryptDecimal(f.expense_transportation) ?? new Prisma.Decimal(0); }
                },
                expense_others: {
                    needs: { expense_others: true },
                    compute(f) { return decryptDecimal(f.expense_others) ?? new Prisma.Decimal(0); }
                }
            },
            userBankDetails: {
                account_no: {
                    needs: { account_no: true },
                    compute(b) { return decrypt(b.account_no); }
                },
                ifsc_code: {
                    needs: { ifsc_code: true },
                    compute(b) { return decrypt(b.ifsc_code); }
                }
            },
            userAssets: {
                stocks: {
                    needs: { stocks: true },
                    compute(a) { return decryptDecimal(a.stocks) ?? new Prisma.Decimal(0); }
                },
                fd: {
                    needs: { fd: true },
                    compute(a) { return decryptDecimal(a.fd) ?? new Prisma.Decimal(0); }
                },
                real_estate: {
                    needs: { real_estate: true },
                    compute(a) { return decryptDecimal(a.real_estate) ?? new Prisma.Decimal(0); }
                },
                gold: {
                    needs: { gold: true },
                    compute(a) { return decryptDecimal(a.gold) ?? new Prisma.Decimal(0); }
                },
                cash_saving: {
                    needs: { cash_saving: true },
                    compute(a) { return decryptDecimal(a.cash_saving) ?? new Prisma.Decimal(0); }
                },
                mutual_funds: {
                    needs: { mutual_funds: true },
                    compute(a) { return decryptDecimal(a.mutual_funds) ?? new Prisma.Decimal(0); }
                }
            },
            userInsurance: {
                life_insurance: {
                    needs: { life_insurance: true },
                    compute(i) { return decryptDecimal(i.life_insurance) ?? new Prisma.Decimal(0); }
                },
                health_insurance: {
                    needs: { health_insurance: true },
                    compute(i) { return decryptDecimal(i.health_insurance) ?? new Prisma.Decimal(0); }
                }
            },
            userLoan: {
                outstanding_amount: {
                    needs: { outstanding_amount: true },
                    compute(l) { return decryptDecimal(l.outstanding_amount) ?? new Prisma.Decimal(0); }
                },
                monthly_emi: {
                    needs: { monthly_emi: true },
                    compute(l) { return decryptDecimal(l.monthly_emi) ?? new Prisma.Decimal(0); }
                }
            },
            userGoals: {
                current_saved_amount: {
                    needs: { current_saved_amount: true },
                    compute(g) { return decryptDecimal(g.current_saved_amount) ?? new Prisma.Decimal(0); }
                },
                current_goal_cost: {
                    needs: { current_goal_cost: true },
                    compute(g) { return decryptDecimal(g.current_goal_cost); }
                },
                current_monthly_expense: {
                    needs: { current_monthly_expense: true },
                    compute(g) { return decryptDecimal(g.current_monthly_expense); }
                },
                post_retirement_return: {
                    needs: { post_retirement_return: true },
                    compute(g) { return decryptDecimal(g.post_retirement_return); }
                }
            },
            mfKycIdentity: {
                uid: { needs: { uid: true }, compute(k) { return decrypt(k.uid); } },
                pan_no: { needs: { pan_no: true }, compute(k) { return decrypt(k.pan_no); } },
                full_name: { needs: { full_name: true }, compute(k) { return decrypt(k.full_name); } },
                dob: { needs: { dob: true }, compute(k) { return decrypt(k.dob); } },
                full_address: { needs: { full_address: true }, compute(k) { return decrypt(k.full_address); } },
                mobile_no: { needs: { mobile_no: true }, compute(k) { return decrypt(k.mobile_no); } },
                email_id: { needs: { email_id: true }, compute(k) { return decrypt(k.email_id); } }
            }
        },
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    // Helper to encrypt nested writes (create, update, upsert)
                    const encryptIncomingData = (data: any, modelName: string) => {
                        if (!data) return;

                        if (modelName === "User") {
                            if (data.email) {
                                data.email_hash = generateBlindIndex(data.email);
                                data.email = encrypt(data.email);
                            }
                            if (data.phone_no) {
                                data.phone_hash = generateBlindIndex(data.phone_no);
                                data.phone_no = encrypt(data.phone_no);
                            }
                            if (data.full_name) data.full_name = encrypt(data.full_name);
                            if (data.dob) {
                                const dobStr = data.dob instanceof Date ? data.dob.toISOString() : String(data.dob);
                                data.dob = encrypt(dobStr);
                            }
                        }

                        if (modelName === "UserNetWorthSnapshot") {
                            if (data.netWorth !== undefined) data.netWorth = encrypt(String(data.netWorth));
                            if (data.assets !== undefined) data.assets = encrypt(String(data.assets));
                            if (data.liabilities !== undefined) data.liabilities = encrypt(String(data.liabilities));
                        }

                        if (modelName === "UserFinance") {
                            const fields = ["annual_income", "expense_house", "expense_food", "expense_transportation", "expense_others"];
                            for (const f of fields) {
                                if (data[f] !== undefined) data[f] = encrypt(String(data[f]));
                            }
                        }

                        if (modelName === "UserBankDetails") {
                            if (data.account_no) {
                                data.account_no_hash = generateBlindIndex(data.account_no);
                                data.account_no = encrypt(data.account_no);
                            }
                            if (data.ifsc_code) data.ifsc_code = encrypt(data.ifsc_code);
                        }

                        if (modelName === "UserAssets") {
                            const fields = ["stocks", "fd", "real_estate", "gold", "cash_saving", "mutual_funds"];
                            for (const f of fields) {
                                if (data[f] !== undefined) data[f] = encrypt(String(data[f]));
                            }
                        }

                        if (modelName === "UserInsurance") {
                            const fields = ["life_insurance", "health_insurance"];
                            for (const f of fields) {
                                if (data[f] !== undefined) data[f] = encrypt(String(data[f]));
                            }
                        }

                        if (modelName === "UserLoan") {
                            const fields = ["outstanding_amount", "monthly_emi"];
                            for (const f of fields) {
                                if (data[f] !== undefined) data[f] = encrypt(String(data[f]));
                            }
                        }

                        if (modelName === "UserGoals") {
                            const fields = ["current_saved_amount", "current_goal_cost", "current_monthly_expense", "post_retirement_return"];
                            for (const f of fields) {
                                if (data[f] !== undefined && data[f] !== null) data[f] = encrypt(String(data[f]));
                            }
                        }

                        if (modelName === "MfKycIdentity") {
                            const fields = ["uid", "pan_no", "full_name", "dob", "full_address", "mobile_no", "email_id"];
                            for (const f of fields) {
                                if (data[f] !== undefined && data[f] !== null) data[f] = encrypt(String(data[f]));
                            }
                        }
                    };

                    // Helper to intercept and rewrite search queries to use blind index hashes
                    const rewriteSearchArgs = (where: any, modelName: string) => {
                        if (!where) return;

                        const rewriteKey = (sourceKey: string, targetKey: string) => {
                            if (where[sourceKey] !== undefined && where[sourceKey] !== null) {
                                if (typeof where[sourceKey] === "string") {
                                    where[targetKey] = generateBlindIndex(where[sourceKey]);
                                    delete where[sourceKey];
                                } else if (typeof where[sourceKey] === "object" && where[sourceKey].equals !== undefined) {
                                    where[targetKey] = { equals: generateBlindIndex(where[sourceKey].equals) };
                                    delete where[sourceKey];
                                } else if (typeof where[sourceKey] === "object" && where[sourceKey].in !== undefined && Array.isArray(where[sourceKey].in)) {
                                    where[targetKey] = { in: where[sourceKey].in.map((val: string) => generateBlindIndex(val)) };
                                    delete where[sourceKey];
                                }
                            }
                        };

                        if (modelName === "User") {
                            rewriteKey("email", "email_hash");
                            rewriteKey("phone_no", "phone_hash");
                        }

                        if (modelName === "UserBankDetails") {
                            rewriteKey("account_no", "account_no_hash");
                            if (where.user_account_no_idx && where.user_account_no_idx.account_no_hash) {
                                where.user_account_no_idx.account_no_hash = generateBlindIndex(where.user_account_no_idx.account_no_hash);
                            }
                        }

                        // Recursively traverse compound where clauses (AND, OR, NOT)
                        for (const op of ["AND", "OR", "NOT"]) {
                            if (where[op]) {
                                if (Array.isArray(where[op])) {
                                    for (const subWhere of where[op]) {
                                        rewriteSearchArgs(subWhere, modelName);
                                    }
                                } else {
                                    rewriteSearchArgs(where[op], modelName);
                                }
                            }
                        }
                    };

                    const anyArgs = args as any;

                    // Process writes
                    if (["create", "update", "upsert", "createMany"].includes(operation)) {
                        if (anyArgs.data) {
                            if (Array.isArray(anyArgs.data)) {
                                for (const item of anyArgs.data) {
                                    encryptIncomingData(item, model);
                                }
                            } else {
                                encryptIncomingData(anyArgs.data, model);
                            }
                        }
                        if (anyArgs.create) {
                            encryptIncomingData(anyArgs.create, model);
                        }
                        if (anyArgs.update) {
                            encryptIncomingData(anyArgs.update, model);
                        }
                    }

                    // Process searches/reads
                    if (anyArgs.where) {
                        rewriteSearchArgs(anyArgs.where, model);
                    }

                    return query(args);
                }
            }
        }
    });
}
