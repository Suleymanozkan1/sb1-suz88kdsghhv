<?php
/**
 * Tokenomics Section Template Part
 */
?>

<section id="tokenomics" class="py-20 relative overflow-hidden">
    <div class="container mx-auto px-6 relative">
        <h2 class="text-4xl font-bold text-emerald-800 text-center mb-16">
            <?php echo carbon_get_theme_option('tokenomics_title'); ?>
        </h2>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
            <?php
            $stats = carbon_get_theme_option('tokenomics_stats');
            if ($stats):
                foreach ($stats as $stat): ?>
                    <div class="bg-white/90 backdrop-blur-sm rounded-2xl p-8 shadow-lg">
                        <?php get_template_part('template-parts/icons/' . $stat['icon']); ?>
                        <h3 class="text-xl font-semibold text-emerald-800 mb-2">
                            <?php echo esc_html($stat['title']); ?>
                        </h3>
                        <div class="text-3xl font-bold text-emerald-600 mb-2">
                            <?php echo esc_html($stat['value']); ?>
                        </div>
                        <p class="text-emerald-700"><?php echo esc_html($stat['description']); ?></p>
                    </div>
                <?php endforeach;
            endif; ?>
        </div>

        <!-- Contract Address Section -->
        <div class="bg-white/90 backdrop-blur-sm rounded-2xl p-8 shadow-lg max-w-2xl mx-auto">
            <h3 class="text-2xl font-semibold text-emerald-800 mb-4 text-center">Contract Address</h3>
            <div class="relative">
                <div class="flex items-center justify-between p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                    <code class="text-emerald-800 break-all" id="contract-address">0x7D54fa007bD58F4fff49aDeD96eC93CBf6055a9D</code>
                    <button 
                        onclick="copyToClipboard()"
                        class="ml-4 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors flex items-center gap-2"
                    >
                        <span id="copy-text">Copy</span>
                        <?php get_template_part('template-parts/icons/copy'); ?>
                    </button>
                </div>
            </div>
        </div>
    </div>
</section>

<script>
function copyToClipboard() {
    const address = document.getElementById('contract-address').textContent;
    navigator.clipboard.writeText(address).then(() => {
        const copyText = document.getElementById('copy-text');
        copyText.textContent = 'Copied!';
        setTimeout(() => {
            copyText.textContent = 'Copy';
        }, 2000);
    });
}
</script>