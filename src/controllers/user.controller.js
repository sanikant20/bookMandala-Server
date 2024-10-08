import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { User } from "../models/user.model.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"


// Generate AccessToken
const generateAccessTokens = async (userId) => {
    const user = await User.findById(userId)

    const accessToken = await user.generateAccessToken()

    // Save Access Token
    user.accessToken = accessToken
    await user.save({ validateBeforeSave: false })

    return { accessToken }
}

// 
const options = {
    httpOnly: true,
    secure: true,
    // sameSite: "Strict",
    // maxAge: 7 * 24 * 60 * 60 * 1000, // Cookie expires in 7 days,
    // path: "/",
    // domain: process.env.CORS_ORIGIN,
}

// Register User Controller
const register = asyncHandler(async (req, res) => {
    const { fullname, email, phoneNumber, dob, gender, password } = req.body

    if (
        [fullname, email, phoneNumber, dob, gender, password].some((field) => field?.trim === "")
    ) {
        throw new ApiError(404, "All fields are required.")
    }

    const existedUser = await User.findOne(
        {
            $or: [{ email }]
        }
    )
    if (existedUser) {
        throw new ApiError(409, `User already exist with ${email}. Please enter another email.`)
    }

    const avatarFiles = req.files?.avatar;
    if (!avatarFiles || avatarFiles.length === 0) {
        throw new ApiError(400, "Avatar is missing");
    }

    const avatarLocalFilePath = avatarFiles[0].path;
    if (!avatarLocalFilePath) {
        throw new ApiError(400, "Avatar file path is missing");
    }

    const cloudAvatar = await uploadOnCloudinary(avatarLocalFilePath)
    if (!cloudAvatar) {
        throw new ApiError(400, "Failed to upload avatar on cloudinary.")
    }

    const user = await User.create(
        {
            fullname,
            email: email.toLowerCase(),
            phoneNumber,
            dob,
            gender,
            password,
            avatar: cloudAvatar.url

        }
    )
    const userRegister = await User.findById(user._id).select("-password -refreshToken")
    if (!userRegister) {
        throw new ApiError(500, "Something went wrong while user register")
    }

    return res.status(200).json(new ApiResponse(200, userRegister, "User register successfully."))

})

// Login User Controller
const login = asyncHandler(async (req, res) => {
    const { email, password } = req.body
    if (!(email || password)) {
        throw new ApiError(400, "email and password are required.")
    }

    const user = await User.findOne({ email })
    if (!user) {
        throw new ApiError(404, "Invalid Email")
    }

    const isValidPassword = await user.isPasswordCorrect(password)
    if (!isValidPassword) {
        throw new ApiError(404, "Invalid Password")
    }

    // Generate refresh token for the user
    const { accessToken } = await generateAccessTokens(user._id);

    const loggedInUser = await User.findById(user._id).select("-password -accessToken")

    return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .json(new ApiResponse(200, { user: loggedInUser, "accessToken": accessToken }, "Login successfully"))
})

// logout Controller
const logout = asyncHandler(async (req, res) => {
    try {
        const { _id: userId } = req.user
        if (!userId) {
            throw new ApiError(400, "User is not logged in.")
        }

        const user = await User.findByIdAndUpdate(userId,
            {
                $unset: {
                    accessToken: 1
                }
            },
            {
                new: true
            }
        )
        if (!user) {
            throw new ApiError(500, "Something went wrong while logging out.")
        }

        return res
            .status(200)
            .clearCookie("accessToken", options)
            .json(new ApiResponse(200, {}, "Logout successfully"))

    } catch (error) {
        return console.log(error.statusCode, error.message)
    }
})

// Get Current User Controller
const getCurrentUser = asyncHandler(async (req, res) => {
    try {
        const { _id: userId } = req.user
        if (!userId) {
            throw new ApiError(400, "User is not logged in.")
        }

        const user = await User.findById(userId)
        if (!user) {
            throw new ApiError(404, "User not found.")
        }

        return res.status(200).json(new ApiResponse(200, user, "User retrieved successfully."))

    } catch (error) {
        return console.log(error.statusCode, error.message)
    }
})

// Edit User Data Controller
const editUserData = asyncHandler(async (req, res) => {
    try {
        const { _id: userId } = req.user
        if (!userId) {
            throw new ApiError(400, "User is not logged in.")
        }

        const { fullname, phoneNumber, dob, gender, shippingAddress } = req.body

        const user = await User.findByIdAndUpdate(userId,
            {
                $set: {
                    fullname: fullname,
                    phoneNumber: phoneNumber,
                    dob: dob,
                    gender: gender,
                    shippingAddress: shippingAddress
                }
            },
            {
                new: true
            }
        ).select("-password -email")
        if (!user) {
            throw new ApiError(500, "Something went wrong while updating user data.")
        }

        return res.status(200).json(new ApiResponse(200, user, "User data updated successfully."))
    } catch (error) {
        return res.status(error.statusCode || 500).json(new ApiError(500, error.message));
    }
})

// Update Avatar Controller
const updateAvatar = asyncHandler(async (req, res) => {
    try {
        const { _id: userId } = req.user
        if (!userId) {
            throw new ApiError(400, "User is not logged in.")
        }

        const avatarLocalFilepath = await req.file?.path
        if (!avatarLocalFilepath) {
            throw new ApiError(400, "Avatar is required for updating avatar.")
        }

        const cloudAvatar = await uploadOnCloudinary(avatarLocalFilepath)
        if (!cloudAvatar) {
            throw new ApiError(400, "Failed to upload avatar on cloudinary.")
        }

        const user = await User.findByIdAndUpdate(userId,
            {
                $set: {
                    avatar: cloudAvatar.url
                }
            },
            {
                new: true
            }
        )
        if (!user) {
            throw new ApiError(500, "Something went wrong while updating avatar.")
        }

        return res.status(200).json(new ApiResponse(200, user, "Avatar updated successfully."))
    } catch (error) {
        return res.status(error.statusCode || 500).json(new ApiError(500, error.message));
    }
})

// Change Password Controller
const changePassword = asyncHandler(async (req, res) => {
    try {
        const { oldPassword, newPassword, confirmNewPassword } = req.body
        if (!(oldPassword && newPassword && confirmNewPassword)) {
            throw new ApiError(400, "All fields are required.")
        }
        if (newPassword !== confirmNewPassword) {
            throw new ApiError(400, "newPassword and confirmNewPassword does not match.")
        }

        const { _id: userId } = req.user
        if (!userId) {
            throw new ApiError(400, "User is not logged in.")
        }


        const user = await User.findById(userId)
        if (!user) {
            throw new ApiError(404, "User not found.")
        }

        const isOldPasswordCorrect = await user.isPasswordCorrect(oldPassword)
        if (!isOldPasswordCorrect) {
            throw new ApiError(400, "Old password is incorrect.")
        }

        user.password = newPassword
        await user.save({ validateBeforeSave: false })

        return res.status(200).json(new ApiResponse(200, user, "Password updated successfully."))
    } catch (error) {
        return res.status(error.statusCode || 500).json(new ApiError(500, error.message));
    }
})


// Export Controllers
export {
    register,
    login,
    logout,
    getCurrentUser,
    editUserData,
    updateAvatar,
    changePassword
}