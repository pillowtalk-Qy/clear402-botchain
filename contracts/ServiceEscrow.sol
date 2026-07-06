// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ServiceEscrow {
    enum State {
        Empty,
        Funded,
        Delivered,
        Refunded
    }

    struct Escrow {
        address payer;
        address provider;
        uint256 amount;
        State state;
    }

    mapping(bytes32 => Escrow) public escrows;

    event Funded(bytes32 indexed paymentContextHash, address indexed payer, address indexed provider, uint256 amount);
    event Delivered(bytes32 indexed paymentContextHash, address indexed provider);
    event Refunded(bytes32 indexed paymentContextHash, address indexed payer, uint256 amount);

    error InvalidContextHash();
    error InvalidProvider();
    error InvalidAmount();
    error InvalidState(State current);
    error Unauthorized();
    error RefundFailed();

    function fund(bytes32 paymentContextHash, address provider, uint256 amount) external payable {
        if (paymentContextHash == bytes32(0)) revert InvalidContextHash();
        if (provider == address(0)) revert InvalidProvider();
        if (amount == 0 || msg.value != amount) revert InvalidAmount();

        Escrow storage escrow = escrows[paymentContextHash];
        if (escrow.state != State.Empty) revert InvalidState(escrow.state);

        escrow.payer = msg.sender;
        escrow.provider = provider;
        escrow.amount = amount;
        escrow.state = State.Funded;

        emit Funded(paymentContextHash, msg.sender, provider, amount);
    }

    function deliver(bytes32 paymentContextHash) external {
        Escrow storage escrow = escrows[paymentContextHash];
        if (escrow.state != State.Funded) revert InvalidState(escrow.state);
        if (msg.sender != escrow.provider) revert Unauthorized();

        escrow.state = State.Delivered;
        emit Delivered(paymentContextHash, msg.sender);
    }

    function refund(bytes32 paymentContextHash) external {
        Escrow storage escrow = escrows[paymentContextHash];
        if (escrow.state != State.Funded) revert InvalidState(escrow.state);
        if (msg.sender != escrow.payer) revert Unauthorized();

        escrow.state = State.Refunded;
        uint256 amount = escrow.amount;
        (bool ok, ) = escrow.payer.call{ value: amount }("");
        if (!ok) revert RefundFailed();

        emit Refunded(paymentContextHash, escrow.payer, amount);
    }
}
