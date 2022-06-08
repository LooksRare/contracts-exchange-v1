// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ISwapRouter} from "./uniswap-interfaces/ISwapRouter.sol";
import {FeeSharingSystem} from "./FeeSharingSystem.sol";

/**
 * @title AggregatorFeeSharingWithUniswapV3
 * @notice It sells WETH to EARTH using Uniswap V3.
 * @dev Prime shares represent the number of shares in the FeeSharingSystem. When not specified, shares represent secondary shares in this contract.
 */
contract AggregatorFeeSharingWithUniswapV3 is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Maximum buffer between 2 harvests (in blocks)
    uint256 public constant MAXIMUM_HARVEST_BUFFER_BLOCKS = 6500;

    // FeeSharingSystem (handles the distribution of WETH for EARTH stakers)
    FeeSharingSystem public immutable feeSharingSystem;

    // Router of Uniswap v3
    ISwapRouter public immutable uniswapRouter;

    // Minimum deposit in EARTH (it is derived from the FeeSharingSystem)
    uint256 public immutable MINIMUM_DEPOSIT_EARTH;

    // EarthRare Token (EARTH)
    IERC20 public immutable earthRareToken;

    // Reward token (WETH)
    IERC20 public immutable rewardToken;

    // Whether harvest and WETH selling is triggered automatically at user action
    bool public canHarvest;

    // Trading fee on Uniswap v3 (e.g., 3000 ---> 0.3%)
    uint24 public tradingFeeUniswapV3;

    // Buffer between two harvests (in blocks)
    uint256 public harvestBufferBlocks;

    // Last user action block
    uint256 public lastHarvestBlock;

    // Maximum price of EARTH (in WETH) multiplied 1e18 (e.g., 0.0004 ETH --> 4e14)
    uint256 public maxPriceEARTHInWETH;

    // Threshold amount (in rewardToken)
    uint256 public thresholdAmount;

    // Total number of shares outstanding
    uint256 public totalShares;

    // Keeps track of number of user shares
    mapping(address => uint256) public userInfo;

    event ConversionToEARTH(uint256 amountSold, uint256 amountReceived);
    event Deposit(address indexed user, uint256 amount);
    event FailedConversion();
    event HarvestStart();
    event HarvestStop();
    event NewHarvestBufferBlocks(uint256 harvestBufferBlocks);
    event NewMaximumPriceEARTHInWETH(uint256 maxPriceEARTHInWETH);
    event NewThresholdAmount(uint256 thresholdAmount);
    event NewTradingFeeUniswapV3(uint24 tradingFeeUniswapV3);
    event Withdraw(address indexed user, uint256 amount);

    /**
     * @notice Constructor
     * @param _feeSharingSystem address of the fee sharing system contract
     * @param _uniswapRouter address of the Uniswap v3 router
     */
    constructor(address _feeSharingSystem, address _uniswapRouter) {
        address earthRareTokenAddress = address(FeeSharingSystem(_feeSharingSystem).earthRareToken());
        address rewardTokenAddress = address(FeeSharingSystem(_feeSharingSystem).rewardToken());

        earthRareToken = IERC20(earthRareTokenAddress);
        rewardToken = IERC20(rewardTokenAddress);

        feeSharingSystem = FeeSharingSystem(_feeSharingSystem);
        uniswapRouter = ISwapRouter(_uniswapRouter);

        IERC20(earthRareTokenAddress).approve(_feeSharingSystem, type(uint256).max);
        IERC20(rewardTokenAddress).approve(_uniswapRouter, type(uint256).max);

        tradingFeeUniswapV3 = 3000;
        MINIMUM_DEPOSIT_EARTH = FeeSharingSystem(_feeSharingSystem).PRECISION_FACTOR();
    }

    /**
     * @notice Deposit EARTH tokens
     * @param amount amount to deposit (in EARTH)
     * @dev There is a limit of 1 EARTH per deposit to prevent potential manipulation of the shares
     */
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        require(amount >= MINIMUM_DEPOSIT_EARTH, "Deposit: Amount must be >= 1 EARTH");

        if (block.number > (lastHarvestBlock + harvestBufferBlocks) && canHarvest && totalShares != 0) {
            _harvestAndSellAndCompound();
        }

        // Transfer EARTH tokens to this address
        earthRareToken.safeTransferFrom(msg.sender, address(this), amount);

        // Fetch the total number of EARTH staked by this contract
        uint256 totalAmountStaked = feeSharingSystem.calculateSharesValueInEARTH(address(this));

        uint256 currentShares = totalShares == 0 ? amount : (amount * totalShares) / totalAmountStaked;
        require(currentShares != 0, "Deposit: Fail");

        // Adjust number of shares for user/total
        userInfo[msg.sender] += currentShares;
        totalShares += currentShares;

        // Deposit to FeeSharingSystem contract
        feeSharingSystem.deposit(amount, false);

        emit Deposit(msg.sender, amount);
    }

    /**
     * @notice Redeem shares for EARTH tokens
     * @param shares number of shares to redeem
     */
    function withdraw(uint256 shares) external nonReentrant {
        require(
            (shares > 0) && (shares <= userInfo[msg.sender]),
            "Withdraw: Shares equal to 0 or larger than user shares"
        );

        _withdraw(shares);
    }

    /**
     * @notice Withdraw all shares of sender
     */
    function withdrawAll() external nonReentrant {
        require(userInfo[msg.sender] > 0, "Withdraw: Shares equal to 0");

        _withdraw(userInfo[msg.sender]);
    }

    /**
     * @notice Harvest pending WETH, sell them to EARTH, and deposit EARTH (if possible)
     * @dev Only callable by owner.
     */
    function harvestAndSellAndCompound() external nonReentrant onlyOwner {
        require(totalShares != 0, "Harvest: No share");
        require(block.number != lastHarvestBlock, "Harvest: Already done");

        _harvestAndSellAndCompound();
    }

    /**
     * @notice Adjust allowance if necessary
     * @dev Only callable by owner.
     */
    function checkAndAdjustEARTHTokenAllowanceIfRequired() external onlyOwner {
        earthRareToken.approve(address(feeSharingSystem), type(uint256).max);
    }

    /**
     * @notice Adjust allowance if necessary
     * @dev Only callable by owner.
     */
    function checkAndAdjustRewardTokenAllowanceIfRequired() external onlyOwner {
        rewardToken.approve(address(uniswapRouter), type(uint256).max);
    }

    /**
     * @notice Update harvest buffer block
     * @param _newHarvestBufferBlocks buffer in blocks between two harvest operations
     * @dev Only callable by owner.
     */
    function updateHarvestBufferBlocks(uint256 _newHarvestBufferBlocks) external onlyOwner {
        require(
            _newHarvestBufferBlocks <= MAXIMUM_HARVEST_BUFFER_BLOCKS,
            "Owner: Must be below MAXIMUM_HARVEST_BUFFER_BLOCKS"
        );
        harvestBufferBlocks = _newHarvestBufferBlocks;

        emit NewHarvestBufferBlocks(_newHarvestBufferBlocks);
    }

    /**
     * @notice Start automatic harvest/selling transactions
     * @dev Only callable by owner
     */
    function startHarvest() external onlyOwner {
        canHarvest = true;

        emit HarvestStart();
    }

    /**
     * @notice Stop automatic harvest transactions
     * @dev Only callable by owner
     */
    function stopHarvest() external onlyOwner {
        canHarvest = false;

        emit HarvestStop();
    }

    /**
     * @notice Update maximum price of EARTH in WETH
     * @param _newMaxPriceEARTHInWETH new maximum price of EARTH in WETH times 1e18
     * @dev Only callable by owner
     */
    function updateMaxPriceOfEARTHInWETH(uint256 _newMaxPriceEARTHInWETH) external onlyOwner {
        maxPriceEARTHInWETH = _newMaxPriceEARTHInWETH;

        emit NewMaximumPriceEARTHInWETH(_newMaxPriceEARTHInWETH);
    }

    /**
     * @notice Adjust trading fee for Uniswap v3
     * @param _newTradingFeeUniswapV3 new tradingFeeUniswapV3
     * @dev Only callable by owner. Can only be 10,000 (1%), 3000 (0.3%), or 500 (0.05%).
     */
    function updateTradingFeeUniswapV3(uint24 _newTradingFeeUniswapV3) external onlyOwner {
        require(
            _newTradingFeeUniswapV3 == 10000 || _newTradingFeeUniswapV3 == 3000 || _newTradingFeeUniswapV3 == 500,
            "Owner: Fee invalid"
        );

        tradingFeeUniswapV3 = _newTradingFeeUniswapV3;

        emit NewTradingFeeUniswapV3(_newTradingFeeUniswapV3);
    }

    /**
     * @notice Adjust threshold amount for periodic Uniswap v3 WETH --> EARTH conversion
     * @param _newThresholdAmount new threshold amount (in WETH)
     * @dev Only callable by owner
     */
    function updateThresholdAmount(uint256 _newThresholdAmount) external onlyOwner {
        thresholdAmount = _newThresholdAmount;

        emit NewThresholdAmount(_newThresholdAmount);
    }

    /**
     * @notice Pause
     * @dev Only callable by owner
     */
    function pause() external onlyOwner whenNotPaused {
        _pause();
    }

    /**
     * @notice Unpause
     * @dev Only callable by owner
     */
    function unpause() external onlyOwner whenPaused {
        _unpause();
    }

    /**
     * @notice Calculate price of one share (in EARTH token)
     * Share price is expressed times 1e18
     */
    function calculateSharePriceInEARTH() external view returns (uint256) {
        uint256 totalAmountStakedWithAggregator = feeSharingSystem.calculateSharesValueInEARTH(address(this));

        return
            totalShares == 0
                ? MINIMUM_DEPOSIT_EARTH
                : (totalAmountStakedWithAggregator * MINIMUM_DEPOSIT_EARTH) / (totalShares);
    }

    /**
     * @notice Calculate price of one share (in prime share)
     * Share price is expressed times 1e18
     */
    function calculateSharePriceInPrimeShare() external view returns (uint256) {
        (uint256 totalNumberPrimeShares, , ) = feeSharingSystem.userInfo(address(this));

        return
            totalShares == 0 ? MINIMUM_DEPOSIT_EARTH : (totalNumberPrimeShares * MINIMUM_DEPOSIT_EARTH) / totalShares;
    }

    /**
     * @notice Calculate shares value of a user (in EARTH)
     * @param user address of the user
     */
    function calculateSharesValueInEARTH(address user) external view returns (uint256) {
        uint256 totalAmountStakedWithAggregator = feeSharingSystem.calculateSharesValueInEARTH(address(this));

        return totalShares == 0 ? 0 : (totalAmountStakedWithAggregator * userInfo[user]) / totalShares;
    }

    /**
     * @notice Harvest pending WETH, sell them to EARTH, and deposit EARTH (if possible)
     */
    function _harvestAndSellAndCompound() internal {
        // Try/catch to prevent revertions if nothing to harvest
        try feeSharingSystem.harvest() {} catch {}

        uint256 amountToSell = rewardToken.balanceOf(address(this));

        if (amountToSell >= thresholdAmount) {
            bool isExecuted = _sellRewardTokenToEARTH(amountToSell);

            if (isExecuted) {
                uint256 adjustedAmount = earthRareToken.balanceOf(address(this));

                if (adjustedAmount >= MINIMUM_DEPOSIT_EARTH) {
                    feeSharingSystem.deposit(adjustedAmount, false);
                }
            }
        }

        // Adjust last harvest block
        lastHarvestBlock = block.number;
    }

    /**
     * @notice Sell WETH to EARTH
     * @param _amount amount of rewardToken to convert (WETH)
     * @return whether the transaction went through
     */
    function _sellRewardTokenToEARTH(uint256 _amount) internal returns (bool) {
        uint256 amountOutMinimum = maxPriceEARTHInWETH != 0 ? (_amount * 1e18) / maxPriceEARTHInWETH : 0;

        // Set the order parameters
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams(
            address(rewardToken), // tokenIn
            address(earthRareToken), // tokenOut
            tradingFeeUniswapV3, // fee
            address(this), // recipient
            block.timestamp, // deadline
            _amount, // amountIn
            amountOutMinimum, // amountOutMinimum
            0 // sqrtPriceLimitX96
        );

        // Swap on Uniswap V3
        try uniswapRouter.exactInputSingle(params) returns (uint256 amountOut) {
            emit ConversionToEARTH(_amount, amountOut);
            return true;
        } catch {
            emit FailedConversion();
            return false;
        }
    }

    /**
     * @notice Withdraw shares
     * @param _shares number of shares to redeem
     * @dev The difference between the two snapshots of EARTH balances is used to know how many tokens to transfer to user.
     */
    function _withdraw(uint256 _shares) internal {
        if (block.number > (lastHarvestBlock + harvestBufferBlocks) && canHarvest) {
            _harvestAndSellAndCompound();
        }

        // Take snapshot of current EARTH balance
        uint256 previousBalanceEARTH = earthRareToken.balanceOf(address(this));

        // Fetch total number of prime shares
        (uint256 totalNumberPrimeShares, , ) = feeSharingSystem.userInfo(address(this));

        // Calculate number of prime shares to redeem based on existing shares (from this contract)
        uint256 currentNumberPrimeShares = (totalNumberPrimeShares * _shares) / totalShares;

        // Adjust number of shares for user/total
        userInfo[msg.sender] -= _shares;
        totalShares -= _shares;

        // Withdraw amount equivalent in prime shares
        feeSharingSystem.withdraw(currentNumberPrimeShares, false);

        // Calculate the difference between the current balance of EARTH with the previous snapshot
        uint256 amountToTransfer = earthRareToken.balanceOf(address(this)) - previousBalanceEARTH;

        // Transfer the EARTH amount back to user
        earthRareToken.safeTransfer(msg.sender, amountToTransfer);

        emit Withdraw(msg.sender, amountToTransfer);
    }
}
