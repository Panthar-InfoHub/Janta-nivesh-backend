import { z } from "zod";
import type { Prisma } from "../../prisma/generated/prisma/client.js";

export type DigilockerData = {
    uid: string;
    name: string;
    dob: string;
    gender: string;
    address: string;
    splitAddress: {
        district: string[];
        state: string[][];
        city: string[];
        pincode: string;
        country: string[];
        addressLine: string;
        landMark: string;
    };
    photo: string;
    fullImage: string;
};

export const update_kyc_data_schema = z.object({
    gender: z.enum(["M", "F", "O"]),
    maritalStatus: z.string(),
    fatherTitle: z.string(),
    panNumber: z.string(),
    aadhaarNumber: z.string().length(12),
    motherTitle: z.string(),
    residentialStatus: z.string().default("Resident Individual"),
    occupationDescription: z.string(),
    occupationCode: z.string(),
    kycAccountCode: z.string().default("01"),
    kycAccountDescription: z.string().default("New"),
    communicationAddressCode: z.string().default("02"),
    communicationAddressType: z.string().default("Residential"),
    permanentAddressCode: z.string().default("02"),
    permanentAddressType: z.string().default("Residential"),
    citizenshipCountryCode: z.string().default("101"),
    citizenshipCountry: z.string().default("India"),
    applicationStatusCode: z.string().default("R"),
    applicationStatusDescription: z.string().default("Resident Indian"),
    mobileNumber: z.string(),
    countryCode: z.number().default(91),
    emailId: z.string().email(),
    fatherName: z.string(),
    motherName: z.string(),
    placeOfBirth: z.string(),
    name: z.string(),
    dob: z.string(),
    nomineeRelationShip: z.string().optional()
});

export type UpdateKycDataInput = z.infer<typeof update_kyc_data_schema>;

export const map_digilocker_to_identity = (data: DigilockerData): any => ({
    uid: data.uid,
    full_name: data.name,
    dob: data.dob,
    pan_no: "",
    gender: data.gender,
    full_address: data.address,
    address_line: data.splitAddress?.addressLine || data.address,
    land_mark: data.splitAddress?.landMark || "",
    pincode: data.splitAddress?.pincode || "",
    city: data.splitAddress?.city?.[0] || "",
    district: data.splitAddress?.district?.[0] || "",
    state: data.splitAddress?.state?.[0]?.[0] || "",
    country: data.splitAddress?.country?.at(-1) || "INDIA",
    digilocker_photo_url: data.photo || "",
    aadhaar_pdf_url: data.fullImage || "",
});

export const map_kyc_data_to_identity = (data: UpdateKycDataInput) => ({
    pan_no: data.panNumber,
    marital_status: data.maritalStatus,
    residential_status: data.residentialStatus,
    place_of_birth: data.placeOfBirth,
    father_title: data.fatherTitle,
    father_name: data.fatherName,
    mother_title: data.motherTitle,
    mother_name: data.motherName,
    occupation_desc: data.occupationDescription,
    occupation_code: data.occupationCode,
    kyc_account_code: data.kycAccountCode,
    communication_addr_code: data.communicationAddressCode,
    permanent_addr_code: data.permanentAddressCode,
    citizenship_country_code: data.citizenshipCountryCode,
    application_status_code: data.applicationStatusCode,
    mobile_no: data.mobileNumber,
    email_id: data.emailId,
});
