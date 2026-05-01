const LoyaltyProgram = require('../model/loyalty_program');
const Restaurant = require('../model/restaurant');

exports.setupProgram = async (req, res) => {
    try {
        const { restaurantId, rewards } = req.body;

        const restaurant = await Restaurant.findById(restaurantId);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        // Authorization check
        if (restaurant.owner.toString() !== req.user.id && !['manager'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const program = new LoyaltyProgram({
            restaurant: restaurantId,
            rewards: rewards || []
        });

        await program.save();

        restaurant.loyaltyProgram.push(program._id);
        await restaurant.save();

        res.status(201).json(program);
    } catch (error) {
        console.error("🔥 Error in setupProgram:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getProgramByRestaurant = async (req, res) => {
    try {
        const programs = await LoyaltyProgram.find({ restaurant: req.params.restaurantId });
        if (!programs || programs.length === 0) {
            return res.status(404).json({ message: 'Loyalty program not found' });
        }

        const restaurant = await Restaurant.findById(req.params.restaurantId).select('themeColor name location');
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found' });
        }

        res.json({
            themeColor: restaurant.themeColor,
            name: restaurant.name,
            location: restaurant.location,
            programs
        });
    } catch (error) {
        console.error("🔥 Error in getProgramByRestaurant:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.updateProgram = async (req, res) => {
    try {
        const { rewards } = req.body;
        const programId = req.params.programId;

        const program = await LoyaltyProgram.findById(programId);
        if (!program) {
            return res.status(404).json({ message: 'Loyalty program not found' });
        }

        const restaurant = await Restaurant.findById(program.restaurant);
        if (!restaurant) {
            return res.status(404).json({ message: 'Associated restaurant not found' });
        }

        // Authorization check
        if (restaurant.owner.toString() !== req.user.id && !['manager'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (rewards) {
            program.rewards = rewards;
        }

        await program.save();
        res.json(program);
    } catch (error) {
        console.error("🔥 Error in updateProgram:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.addReward = async (req, res) => {
    try {
        const { stampsRequired, rewardDescription } = req.body;
        const programId = req.params.programId;

        const program = await LoyaltyProgram.findById(programId);
        if (!program) {
            return res.status(404).json({ message: 'Loyalty program not found' });
        }

        const restaurant = await Restaurant.findById(program.restaurant);
        if (!restaurant) {
            return res.status(404).json({ message: 'Associated restaurant not found' });
        }

        // Authorization check
        if (restaurant.owner.toString() !== req.user.id && !['manager'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        program.rewards.push({ stampsRequired, rewardDescription });
        await program.save();

        res.json(program);
    } catch (error) {
        console.error("🔥 Error in addReward:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.removeReward = async (req, res) => {
    try {
        const { programId, rewardId } = req.params;

        const program = await LoyaltyProgram.findById(programId);
        if (!program) {
            return res.status(404).json({ message: 'Loyalty program not found' });
        }

        const restaurant = await Restaurant.findById(program.restaurant);
        if (!restaurant) {
            return res.status(404).json({ message: 'Associated restaurant not found' });
        }

        // Authorization check
        if (restaurant.owner.toString() !== req.user.id && !['manager'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        program.rewards.pull({ _id: rewardId });
        await program.save();

        res.json(program);
    } catch (error) {
        console.error("🔥 Error in removeReward:", error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
